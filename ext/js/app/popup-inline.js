/*
 * Copyright (C) 2023-2025  Yomitan Authors
 * Copyright (C) 2019-2022  Yomichan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import {EventDispatcher} from '../core/event-dispatcher.js';
import {generateId} from '../core/utilities.js';
import {AnkiNoteBuilder} from '../data/anki-note-builder.js';
import {getDynamicTemplates} from '../data/anki-template-util.js';
import {INVALID_NOTE_ID} from '../data/anki-util.js';
import {DisplayContentManager} from '../display/display-content-manager.js';
import {DisplayGenerator} from '../display/display-generator.js';
import {TemplateRendererProxy} from '../templates/template-renderer-proxy.js';

export class PopupInline extends EventDispatcher {
    constructor(application, id, depth, frameId, childrenSupported) {
        super();
        this._application = application;
        this._id = id;
        this._depth = depth;
        this._frameId = frameId;
        this._childrenSupported = childrenSupported;
        this._parent = null;
        this._child = null;
        this._optionsContext = null;
        this._container = document.createElement('div');
        this._container.className = 'yomitan-inline-popup';
        this._container.hidden = true;
        this._container.style.position = 'fixed';
        this._container.style.zIndex = '2147483647';
        this._container.style.left = '0';
        this._container.style.top = '0';
        this._container.style.width = '300px';
        this._container.style.maxWidth = '300px';
        this._container.style.maxHeight = '400px';
        this._container.style.overflow = 'auto';
        this._container.style.boxSizing = 'border-box';
        this._container.style.border = '1px solid rgba(0, 0, 0, 0.18)';
        this._container.style.borderRadius = '10px';
        this._container.style.background = '#ffffff';
        this._container.style.color = '#111827';
        this._container.style.boxShadow = '0 16px 40px rgba(0, 0, 0, 0.25)';
        this._container.style.padding = '12px';
        this._container.style.font = '14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        this._container.style.wordBreak = 'break-word';
        this._container.style.display = 'none';
        this._container.style.opacity = '0';
        this._container.style.transition = 'opacity 180ms ease';
        this._container.style.whiteSpace = 'normal';
        this._container.style.textAlign = 'left';
        this._container.style.userSelect = 'text';
        this._container.addEventListener('mouseenter', this._onMouseEnter.bind(this), false);
        this._container.addEventListener('mouseleave', this._onMouseLeave.bind(this), false);
        this._container.addEventListener('mousedown', (e) => e.stopPropagation(), false);
        this._container.addEventListener('click', (e) => e.stopPropagation(), false);
        this._visible = false;
        this._isPointerOver = false;
        this._hidePopupTimer = null;
        this._fadeTimer = null;
        this._frameRect = {left: 0, top: 0, right: 0, bottom: 0, valid: false};
        this._initialWidth = 300;
        this._initialHeight = 400;
        this._horizontalOffset = 0;
        this._verticalOffset = 10;
        this._horizontalOffset2 = 10;
        this._verticalOffset2 = 0;
        this._hidePopupOnCursorExit = false;
        this._hidePopupOnCursorExitDelay = 0;
        this._visibleOverrides = new Map();
        this._shadow = this._container.attachShadow({mode: 'open'});
        this._contentRoot = null;
        this._displayGenerator = null;
        this._displayContentManager = null;
        this._dictionaryInfo = null;
        this._setupPromise = null;
        this._options = null;
        this._ankiFieldTemplates = null;
        this._templateRenderer = new TemplateRendererProxy();
        this._ankiNoteBuilder = new AnkiNoteBuilder(this._application.api, this._templateRenderer);
        this._renderToken = null;
        this._savedPosition = null;
        this._positionLoaded = false;
        this._dragState = null;
        this._lastPosition = null;
        this._onDragMove = this._onDragMove.bind(this);
        this._onDragEnd = this._onDragEnd.bind(this);

        this._container.addEventListener('mousedown', this._onDragStart.bind(this), false);
    }

    get id() { return this._id; }
    get parent() { return this._parent; }
    set parent(value) { this._parent = value; }
    get child() { return this._child; }
    set child(value) { this._child = value; }
    get depth() { return this._depth; }
    get frameContentWindow() { return window; }
    get container() { return this._container; }
    get frameId() { return this._frameId; }

    prepare() {
        if (this._container.parentNode === null) {
            document.documentElement.appendChild(this._container);
        }
    }

    async setOptionsContext(optionsContext) {
        const optionsContext2 = this._normalizeOptionsContext(optionsContext);
        this._optionsContext = optionsContext2;
        const options = await this._application.api.optionsGet(optionsContext2);
        this._options = options;
        const {general, scanning} = options;
        this._initialWidth = general.popupWidth;
        this._initialHeight = general.popupHeight;
        this._horizontalOffset = general.popupHorizontalOffset;
        this._verticalOffset = general.popupVerticalOffset;
        this._horizontalOffset2 = general.popupHorizontalOffset2;
        this._verticalOffset2 = general.popupVerticalOffset2;
        this._hidePopupOnCursorExit = scanning.hidePopupOnCursorExit;
        this._hidePopupOnCursorExitDelay = scanning.hidePopupOnCursorExitDelay;
        this._updateContainerSize();
    }

    hide(_changeFocus) {
        this.stopHideDelayed();
        this._visible = false;
        this._container.hidden = true;
        this._container.style.display = 'none';
        this._container.style.opacity = '0';
        this._frameRect = {left: 0, top: 0, right: 0, bottom: 0, valid: false};
        if (this._child !== null) {
            this._child.hide(false);
        }
    }

    hideDelayed(delay) {
        if (this.isPointerOverSelfOrChildren() || this._dragState !== null) { return; }
        if (delay > 0) {
            this.stopHideDelayed();
            this._hidePopupTimer = setTimeout(() => {
                this._hidePopupTimer = null;
                if (!this.isPointerOverSelfOrChildren() && this._dragState === null) {
                    this._startFadeOut();
                }
            }, delay);
        } else {
            this._startFadeOut();
        }
    }

    stopHideDelayed() {
        if (this._hidePopupTimer !== null) {
            clearTimeout(this._hidePopupTimer);
            this._hidePopupTimer = null;
        }
        if (this._fadeTimer !== null) {
            clearTimeout(this._fadeTimer);
            this._fadeTimer = null;
        }
        if (this._visible) {
            this._container.style.opacity = '1';
        }
    }

    async isVisible() {
        return this.isVisibleSync();
    }

    async setVisibleOverride(value, _priority) {
        const token = generateId(16);
        this._visibleOverrides.set(token, value);
        if (!value) {
            this.hide(false);
        } else if (this._container.textContent !== '') {
            this._visible = true;
            this._container.hidden = false;
            this._container.style.display = 'block';
            this._container.style.opacity = '1';
        }
        return token;
    }

    async clearVisibleOverride(token) {
        return this._visibleOverrides.delete(token);
    }

    async containsPoint(x, y) {
        const {left, top, right, bottom, valid} = this._frameRect;
        return valid && x >= left && x < right && y >= top && y < bottom;
    }

    async showContent(details, displayDetails) {
        const optionsContext = this._normalizeOptionsContext(details.optionsContext);
        if (this._optionsContext === null) {
            await this.setOptionsContext(optionsContext);
        } else if (JSON.stringify(this._optionsContext) !== JSON.stringify(optionsContext)) {
            await this.setOptionsContext(optionsContext);
        }

        this.stopHideDelayed();
        this.prepare();
        const renderToken = {};
        this._renderToken = renderToken;
        await this._render(displayDetails, renderToken);
        if (this._renderToken !== renderToken) { return; }
        await this._ensurePositionLoaded();
        if (this._renderToken !== renderToken) { return; }
        if (!this._visible || !this._frameRect.valid) {
            this._position(details.sourceRects);
        }
        this._visible = true;
        this._container.hidden = false;
        this._container.style.display = 'block';
        this._container.style.opacity = '1';
    }

    async setCustomCss(_css) {}
    async clearAutoPlayTimer() {}
    async setContentScale(scale) {
        this._container.style.fontSize = `${14 * scale}px`;
    }
    isVisibleSync() { return this._visible; }
    async updateTheme() {}
    async setCustomOuterCss(_css, _useWebExtensionApi) {}
    getFrameRect() { return this._frameRect; }
    async getFrameSize() {
        const rect = this._container.getBoundingClientRect();
        return {width: rect.width, height: rect.height, valid: this._visible};
    }
    async setFrameSize(width, height) {
        this._initialWidth = width;
        this._initialHeight = height;
        this._container.style.width = `${width}px`;
        this._container.style.maxWidth = `${width}px`;
        this._container.style.maxHeight = `${height}px`;
        return true;
    }
    isPointerOver() { return this._isPointerOver; }

    isPointerOverSelfOrChildren() {
        if (this._isPointerOver) { return true; }
        for (let popup = this._child; popup !== null; popup = popup.child) {
            if (popup.isPointerOver()) { return true; }
        }
        return false;
    }

    _onMouseEnter() {
        this.stopHideDelayed();
        this._isPointerOver = true;
        this.trigger('mouseOver', {});
    }

    _onMouseLeave() {
        this._isPointerOver = false;
        this.trigger('mouseOut', {});
        if (this._hidePopupOnCursorExit) {
            this.hideDelayed(this._hidePopupOnCursorExitDelay);
        }
    }

    _onDragStart(e) {
        if (e.button !== 0) { return; }
        const target = /** @type {Element?} */ (e.composedPath()[0] ?? null);
        if (target !== null && target.closest('a, button, input, select, textarea, summary')) { return; }

        this.stopHideDelayed();
        const rect = this._container.getBoundingClientRect();
        this._dragState = {
            offsetX: e.clientX - rect.left,
            offsetY: e.clientY - rect.top,
        };
        window.addEventListener('mousemove', this._onDragMove, true);
        window.addEventListener('mouseup', this._onDragEnd, true);
        e.preventDefault();
        e.stopPropagation();
    }

    _onDragMove(e) {
        if (this._dragState === null) { return; }
        const {offsetX, offsetY} = this._dragState;
        const left = e.clientX - offsetX;
        const top = e.clientY - offsetY;
        const position = this._clampPosition(left, top);
        this._applyPosition(position.left, position.top);
    }

    _onDragEnd() {
        if (this._dragState === null) { return; }
        this._dragState = null;
        window.removeEventListener('mousemove', this._onDragMove, true);
        window.removeEventListener('mouseup', this._onDragEnd, true);
        void this._savePosition();
    }

    _startFadeOut() {
        if (!this._visible || this._dragState !== null) { return; }
        this._container.style.opacity = '0';
        if (this._fadeTimer !== null) {
            clearTimeout(this._fadeTimer);
        }
        this._fadeTimer = setTimeout(() => {
            this._fadeTimer = null;
            if (!this.isPointerOverSelfOrChildren() && this._dragState === null) {
                this.hide(false);
            }
        }, 180);
    }

    _position(_sourceRects) {
        const width = Math.min(this._initialWidth, Math.max(160, window.innerWidth - 16));
        const height = Math.min(this._initialHeight, Math.max(120, window.innerHeight - 16));
        this._container.style.width = `${width}px`;
        this._container.style.maxWidth = `${width}px`;
        this._container.style.maxHeight = `${height}px`;
        this._container.style.display = 'block';
        this._container.hidden = false;
        const popupRect = this._container.getBoundingClientRect();
        let left;
        let top;
        if (this._savedPosition !== null) {
            ({left, top} = this._clampPosition(this._savedPosition.left, this._savedPosition.top));
        } else {
            ({left, top} = this._getDefaultPosition(popupRect.width, popupRect.height));
        }
        this._applyPosition(left, top);

        const finalRect = this._container.getBoundingClientRect();
        this._frameRect = {
            left: finalRect.left,
            top: finalRect.top,
            right: finalRect.right,
            bottom: finalRect.bottom,
            valid: true,
        };
    }

    async _render(displayDetails, renderToken) {
        const contentRoot = await this._ensureRenderer();
        if (this._renderToken !== renderToken) { return; }
        const fragment = document.createDocumentFragment();
        if (displayDetails === null) {
            if (contentRoot.childElementCount === 0) {
                contentRoot.replaceChildren(this._createMessage('No popup content available.'));
            }
            return;
        }

        const {content} = displayDetails;
        const dictionaryEntries = Array.isArray(content?.dictionaryEntries) ? content.dictionaryEntries : [];
        const displayGenerator = this._displayGenerator;
        const displayContentManager = this._displayContentManager;
        if (displayGenerator === null || displayContentManager === null) {
            throw new Error('Renderer not initialized');
        }

        if (dictionaryEntries.length === 0) {
            fragment.appendChild(this._createMessage('No results found.'));
            if (this._renderToken !== renderToken) { return; }
            contentRoot.replaceChildren(fragment);
            return;
        }

        displayContentManager.unloadAll();
        const dictionaryInfo = await this._getDictionaryInfo();
        if (this._renderToken !== renderToken) { return; }
        for (const entry of dictionaryEntries.slice(0, 8)) {
            const node = (
                entry.type === 'kanji' ?
                displayGenerator.createKanjiEntry(entry, dictionaryInfo) :
                displayGenerator.createTermEntry(entry, dictionaryInfo)
            );
            await this._addAnkiActions(entry, node, displayDetails);
            if (this._renderToken !== renderToken) { return; }
            fragment.appendChild(node);
        }
        if (this._renderToken !== renderToken) { return; }
        contentRoot.replaceChildren(fragment);
        await displayContentManager.executeMediaRequests();
    }

    async _addAnkiActions(dictionaryEntry, node, displayDetails) {
        const options = this._options;
        if (options === null || !options.anki.enable) { return; }

        const noteActionsContainer = node.querySelector('.note-actions-container');
        if (!(noteActionsContainer instanceof HTMLElement)) { return; }

        const cardFormats = options.anki.cardFormats.filter((cardFormat) => cardFormat.type === dictionaryEntry.type);
        if (cardFormats.length === 0) { return; }

        const template = await this._getAnkiFieldTemplates(options);
        const context = this._createAnkiContext(displayDetails);
        const dictionaryStylesMap = this._ankiNoteBuilder.getDictionaryStylesMap(options.dictionaries);

        for (const [cardFormatIndex, cardFormat] of cardFormats.entries()) {
            if (!cardFormat.deck || !cardFormat.model) { continue; }

            let note;
            try {
                ({note} = await this._ankiNoteBuilder.createNote({
                    dictionaryEntry,
                    cardFormat,
                    context,
                    template,
                    tags: options.anki.tags,
                    duplicateScope: options.anki.duplicateScope,
                    duplicateScopeCheckAllModels: options.anki.duplicateScopeCheckAllModels,
                    resultOutputMode: options.general.resultOutputMode,
                    glossaryLayoutMode: options.general.glossaryLayoutMode,
                    compactTags: options.general.compactTags,
                    mediaOptions: null,
                    requirements: [],
                    dictionaryStylesMap,
                }));
            } catch (e) {
                console.error('[Yomitan][Safari][InlinePopup][Anki] Failed to build note', e);
                continue;
            }

            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'action-button-container';
            buttonContainer.dataset.cardFormatIndex = `${cardFormatIndex}`;

            const saveButton = this._createInlineActionButton(cardFormat.icon, `Add ${cardFormat.name} note`);
            saveButton.dataset.action = 'save-note';
            saveButton.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                saveButton.disabled = true;
                try {
                    const noteId = await this._application.api.addAnkiNote(note);
                    console.log('[Yomitan][Safari][InlinePopup][Anki] addAnkiNote', {noteId, cardFormat: cardFormat.name});
                    if (typeof noteId === 'number' && noteId > 0) {
                        const viewButton = this._createInlineActionButton('view-note', `View ${cardFormat.name} note`);
                        viewButton.dataset.action = 'view-note';
                        viewButton.addEventListener('click', async (event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            await this._application.api.viewNotes([noteId], options.anki.noteGuiMode, false);
                        }, false);
                        buttonContainer.replaceChildren(viewButton);
                    } else {
                        saveButton.disabled = false;
                    }
                } catch (error) {
                    console.error('[Yomitan][Safari][InlinePopup][Anki] addAnkiNote failed', error);
                    saveButton.disabled = false;
                }
            }, false);
            buttonContainer.appendChild(saveButton);

            try {
                const [noteInfo] = await this._application.api.getAnkiNoteInfo([note], false);
                const noteIds = Array.isArray(noteInfo?.noteIds) ? noteInfo.noteIds.filter((id) => id !== INVALID_NOTE_ID) : [];
                if (noteIds.length > 0) {
                    const viewButton = this._createInlineActionButton('view-note', `View ${cardFormat.name} note`);
                    viewButton.dataset.action = 'view-note';
                    viewButton.addEventListener('click', async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        await this._application.api.viewNotes(noteIds, options.anki.noteGuiMode, false);
                    }, false);
                    buttonContainer.replaceChildren(viewButton);
                }
            } catch (error) {
                console.error('[Yomitan][Safari][InlinePopup][Anki] getAnkiNoteInfo failed', error);
            }

            noteActionsContainer.appendChild(buttonContainer);
        }
    }

    _createInlineActionButton(icon, title) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'action-button';
        button.title = title;
        const iconNode = document.createElement('span');
        iconNode.className = 'action-icon icon color-icon';
        iconNode.dataset.icon = icon;
        button.appendChild(iconNode);
        return button;
    }

    _createAnkiContext(displayDetails) {
        const historyState = (typeof displayDetails?.state === 'object' && displayDetails.state !== null) ? displayDetails.state : {};
        const sentence = (typeof historyState.sentence === 'object' && historyState.sentence !== null) ? historyState.sentence : null;
        const query = typeof displayDetails?.params?.query === 'string' ? displayDetails.params.query : '';
        return {
            url: typeof historyState.url === 'string' ? historyState.url : window.location.href,
            documentTitle: typeof historyState.documentTitle === 'string' ? historyState.documentTitle : document.title,
            query,
            fullQuery: typeof sentence?.text === 'string' ? sentence.text : query,
            sentence: {
                text: typeof sentence?.text === 'string' ? sentence.text : query,
                offset: typeof sentence?.offset === 'number' ? sentence.offset : 0,
            },
        };
    }

    async _getAnkiFieldTemplates(options) {
        if (typeof options.anki.fieldTemplates === 'string') {
            return options.anki.fieldTemplates;
        }
        if (typeof this._ankiFieldTemplates === 'string') {
            return this._ankiFieldTemplates;
        }
        const dictionaryInfo = await this._getDictionaryInfo();
        const staticTemplates = await this._application.api.getDefaultAnkiFieldTemplates();
        this._ankiFieldTemplates = staticTemplates + getDynamicTemplates(options, dictionaryInfo);
        return this._ankiFieldTemplates;
    }

    _createMessage(text) {
        const node = document.createElement('div');
        node.className = 'inline-message';
        node.textContent = text;
        return node;
    }

    async _ensureRenderer() {
        let setupPromise = this._setupPromise;
        if (setupPromise === null) {
            setupPromise = this._setupRenderer();
            this._setupPromise = setupPromise;
        }
        await setupPromise;
        if (this._contentRoot === null) {
            throw new Error('Renderer root not initialized');
        }
        return this._contentRoot;
    }

    async _setupRenderer() {
        const display = {
            application: this._application,
            setContent() {},
        };
        const displayContentManager = new DisplayContentManager(display);
        const displayGenerator = new DisplayGenerator(displayContentManager, null);
        let [materialCss, displayCss, displayPronunciationCss, structuredContentCss] = await Promise.all([
            this._fetchExtensionText('/css/material.css'),
            this._fetchExtensionText('/css/display.css'),
            this._fetchExtensionText('/css/display-pronunciation.css'),
            this._fetchExtensionText('/css/structured-content.css'),
        ]);
        materialCss = this._transformInlineCss(materialCss);
        displayCss = this._transformInlineCss(displayCss);
        displayPronunciationCss = this._transformInlineCss(displayPronunciationCss);
        structuredContentCss = this._transformInlineCss(structuredContentCss);

        const style = document.createElement('style');
        style.textContent = `${materialCss}\n${displayCss}\n${displayPronunciationCss}\n${structuredContentCss}\n${this._getInlineCssOverrides()}`;

        const wrapper = document.createElement('div');
        wrapper.className = 'content-outer';
        wrapper.dataset.browser = 'safari';
        wrapper.dataset.theme = 'default';
        wrapper.dataset.outerTheme = 'default';
        wrapper.innerHTML = '<div class="content"><div class="content-scroll contain-overscroll scrollbar"><div class="content-body"><div class="content-body-inner"></div></div></div></div>';

        this._shadow.replaceChildren(style, wrapper);
        this._contentRoot = wrapper.querySelector('.content-body-inner');
        this._displayGenerator = displayGenerator;
        this._displayContentManager = displayContentManager;
        await this._prepareDisplayGenerator(displayGenerator);
    }

    async _getDictionaryInfo() {
        if (this._dictionaryInfo === null) {
            this._dictionaryInfo = await this._application.api.getDictionaryInfo();
        }
        return this._dictionaryInfo;
    }

    _normalizeOptionsContext(optionsContext) {
        return (
            typeof optionsContext === 'object' &&
            optionsContext !== null ?
            optionsContext :
            {current: true}
        );
    }

    async _fetchExtensionText(path) {
        const response = await fetch(chrome.runtime.getURL(path), {
            method: 'GET',
            cache: 'default',
            credentials: 'omit',
            redirect: 'follow',
            referrerPolicy: 'no-referrer',
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch ${path}: ${response.status}`);
        }
        return await response.text();
    }

    async _prepareDisplayGenerator(displayGenerator) {
        const htmlRaw = await this._fetchExtensionText('/templates-display.html');
        const domParser = new DOMParser();
        const templatesDocument = domParser.parseFromString(htmlRaw, 'text/html');
        displayGenerator._templates.load(templatesDocument);
        displayGenerator.updateHotkeys();
    }

    _updateContainerSize() {
        this._container.style.width = `${this._initialWidth}px`;
        this._container.style.maxWidth = `${this._initialWidth}px`;
        this._container.style.minHeight = '0';
        this._container.style.maxHeight = `${this._initialHeight}px`;
    }

    async _ensurePositionLoaded() {
        if (this._positionLoaded) { return; }
        this._positionLoaded = true;
        const key = this._getPositionStorageKey();
        const store = await new Promise((resolve) => {
            chrome.storage.local.get([key], (result) => {
                resolve(result);
            });
        });
        const value = store[key];
        if (
            typeof value === 'object' &&
            value !== null &&
            typeof value.left === 'number' &&
            typeof value.top === 'number'
        ) {
            this._savedPosition = {left: value.left, top: value.top};
        }
    }

    async _savePosition() {
        if (this._lastPosition === null) { return; }
        const key = this._getPositionStorageKey();
        const value = {left: this._lastPosition.left, top: this._lastPosition.top};
        this._savedPosition = value;
        await new Promise((resolve) => {
            chrome.storage.local.set({[key]: value}, resolve);
        });
    }

    _getPositionStorageKey() {
        const host = window.location.hostname || 'default';
        return `popupInlinePosition:${host}`;
    }

    _getDefaultPosition(width, height) {
        return this._clampPosition(
            window.innerWidth - width - 16,
            Math.round((window.innerHeight - height) / 2),
        );
    }

    _clampPosition(left, top) {
        const rect = this._container.getBoundingClientRect();
        const width = rect.width || this._initialWidth;
        const height = rect.height || this._initialHeight;
        const margin = 8;
        return {
            left: Math.max(margin, Math.min(Math.round(left), window.innerWidth - width - margin)),
            top: Math.max(margin, Math.min(Math.round(top), window.innerHeight - height - margin)),
        };
    }

    _applyPosition(left, top) {
        this._lastPosition = {left, top};
        this._container.style.left = `${left}px`;
        this._container.style.top = `${top}px`;
    }

    _transformInlineCss(css) {
        const extensionRoot = chrome.runtime.getURL('/');
        return css
            .replaceAll("url('/", `url('${extensionRoot}`)
            .replaceAll('url("/', `url("${extensionRoot}`)
            .replaceAll(':root', ':host')
            .replaceAll('html[data-page-type=popup]', ':host')
            .replaceAll('html[data-page-type="popup"]', ':host')
            .replaceAll('body', '.content-outer');
    }

    _getInlineCssOverrides() {
        return `
:host {
    display: block;
    all: initial;
    contain: content;
}
.content-outer {
    display: block;
    background: var(--background-color);
    color: var(--text-color);
    width: 100%;
    height: auto !important;
    overflow: visible !important;
}
.content {
    display: block;
    position: static !important;
    height: auto !important;
    overflow: visible !important;
}
.content-scroll {
    position: static !important;
    left: auto !important;
    top: auto !important;
    right: auto !important;
    bottom: auto !important;
    display: block !important;
    overflow-x: hidden !important;
    overflow-y: auto !important;
    max-height: none !important;
    height: auto !important;
}
.content-body {
    position: static !important;
    height: auto !important;
    padding: 0;
    overflow: visible !important;
}
.content-body-inner {
    display: block !important;
    position: static !important;
    padding: 0;
    overflow: visible !important;
}
.entry {
    margin: 0;
    border: 0;
    box-shadow: none;
    content-visibility: visible !important;
    contain: none !important;
    contain-intrinsic-height: auto !important;
    visibility: visible !important;
    opacity: 1 !important;
}
.entry * {
    visibility: visible;
}
.entry + .entry {
    border-top: 1px solid var(--light-border-color);
}
.headword-list .headword-details > .action-button[data-action="play-audio"] {
    display: none !important;
}
.entry-current-indicator,
.entry-current-indicator-icon,
.action-popup-menu-button,
.action-popup-button,
.action-button-badge,
.headword-current-indicator,
.entry .expansion-button {
    display: none !important;
}
.entry-header,
.entry-body,
.kanji-glyph-data {
    padding-right: 0 !important;
}
.entry-body-section:first-child,
.entry-body-section[data-section-type="pronunciations"] {
    display: none;
}
.headword-list-tag-list,
.tag-list {
    margin-top: 0.3em;
}
.gloss-sc-table-container {
    overflow-x: auto;
}
.inline-message {
    padding: 0.72em;
    color: var(--text-color);
}
`;
    }

    _getBoundingSourceRect(sourceRects) {
        switch (sourceRects.length) {
            case 0: return {left: 0, top: 0, right: 0, bottom: 0};
            case 1: return sourceRects[0];
        }
        let {left, top, right, bottom} = sourceRects[0];
        for (let i = 1; i < sourceRects.length; ++i) {
            const sourceRect = sourceRects[i];
            left = Math.min(left, sourceRect.left);
            top = Math.min(top, sourceRect.top);
            right = Math.max(right, sourceRect.right);
            bottom = Math.max(bottom, sourceRect.bottom);
        }
        return {left, top, right, bottom};
    }
}
