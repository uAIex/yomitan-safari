/*
 * Copyright (C) 2023-2025  Yomitan Authors
 * Copyright (C) 2017-2022  Yomichan Authors
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

import {ThemeController} from '../app/theme-controller.js';
import {Application} from '../application.js';
import {getAllPermissions, hasRequiredPermissionsForOptions} from '../data/permissions-util.js';
import {HotkeyHelpController} from '../input/hotkey-help-controller.js';
import {HotkeyUtil} from '../input/hotkey-util.js';

class DisplayController {
    /**
     * @param {import('../comm/api.js').API} api
     */
    constructor(api) {
        /** @type {import('../comm/api.js').API} */
        this._api = api;
        /** @type {?import('settings').Options} */
        this._optionsFull = null;
        /** @type {ThemeController} */
        this._themeController = new ThemeController(document.documentElement);
        /** @type {HotkeyUtil} */
        this._hotkeyUtil = new HotkeyUtil();
        /** @type {?HTMLElement} */
        this._ankiDebugPanel = document.querySelector('#anki-debug-panel');
        /** @type {?HTMLElement} */
        this._ankiDebugLog = document.querySelector('#anki-debug-log');
    }

    /** */
    async prepare() {
        this._themeController.prepare();

        const manifest = chrome.runtime.getManifest();

        const {platform: {os}} = await this._api.getEnvironmentInfo();
        this._hotkeyUtil.os = os;

        this._showExtensionInfo(manifest);
        void this._setupEnvironment();
        this._setupButtonEvents('.action-open-search', 'openSearchPage', chrome.runtime.getURL('/search.html'), this._onSearchClick.bind(this));
        this._setupButtonEvents('.action-open-info', 'openInfoPage', chrome.runtime.getURL('/info.html'));

        const optionsFull = await this._api.optionsGetFull();
        this._optionsFull = optionsFull;

        void this._setupHotkeys();

        const optionsPageUrl = (
            typeof manifest.options_ui === 'object' &&
            manifest.options_ui !== null &&
            typeof manifest.options_ui.page === 'string' ?
            manifest.options_ui.page :
            ''
        );
        this._setupButtonEvents('.action-open-settings', 'openSettingsPage', chrome.runtime.getURL(optionsPageUrl));

        const {profiles, profileCurrent} = optionsFull;
        const defaultProfile = (profileCurrent >= 0 && profileCurrent < profiles.length) ? profiles[profileCurrent] : null;
        if (defaultProfile !== null) {
            this._setupOptions(defaultProfile);
        }

        void this._runAnkiDebug(defaultProfile);

        /** @type {NodeListOf<HTMLElement>} */
        const profileSelect = document.querySelectorAll('.action-select-profile');
        for (let i = 0; i < profileSelect.length; i++) {
            profileSelect[i].hidden = (profiles.length <= 1);
        }

        this._updateProfileSelect(profiles, profileCurrent);

        setTimeout(() => {
            document.body.dataset.loaded = 'true';
        }, 10);
    }

    // Private

    /** */
    _updateDisplayModifierKey() {
        const {profiles, profileCurrent} = /** @type {import('settings').Options} */ (this._optionsFull);
        /** @type {NodeListOf<HTMLElement>} */
        const modifierKeyHint = document.querySelectorAll('.tooltip');

        const currentModifierKey = profiles[profileCurrent].options.scanning.inputs[0].include;

        /** @type {{ [key: string]: string }} */
        const modifierKeys = {};
        for (const value of /** @type {import('input').ModifierKey[]} */ (['alt', 'ctrl', 'shift', 'meta'])) {
            const name = this._hotkeyUtil.getModifierDisplayValue(value);
            modifierKeys[value] = name;
        }

        for (let i = 0; i < modifierKeyHint.length; i++) {
            modifierKeyHint[i].textContent = currentModifierKey ? 'Hold ' : 'Hover over text to scan';
            if (currentModifierKey) {
                const em = document.createElement('em');
                em.textContent = modifierKeys[currentModifierKey];
                modifierKeyHint[i].appendChild(em);
                modifierKeyHint[i].appendChild(document.createTextNode(' to scan'));
            }
        }
    }

    /**
     * @param {MouseEvent} e
     */
    _onSearchClick(e) {
        if (!e.shiftKey) { return; }
        e.preventDefault();
        location.href = '/search.html?action-popup=true';
    }

    /**
     * @param {chrome.runtime.Manifest} manifest
     */
    _showExtensionInfo(manifest) {
        const node = document.getElementById('extension-info');
        if (node === null) { return; }

        node.textContent = `${manifest.name} v${manifest.version}`;
    }

    /**
     * @param {string} selector
     * @param {?string} command
     * @param {string} url
     * @param {(event: MouseEvent) => void} [customHandler]
     */
    _setupButtonEvents(selector, command, url, customHandler) {
        /** @type {NodeListOf<HTMLAnchorElement>} */
        const nodes = document.querySelectorAll(selector);
        for (const node of nodes) {
            if (typeof command === 'string') {
                /**
                 * @param {MouseEvent} e
                 */
                const onClick = (e) => {
                    if (e.button !== 0) { return; }
                    if (typeof customHandler === 'function') {
                        const result = customHandler(e);
                        if (typeof result !== 'undefined') { return; }
                    }

                    let mode = 'existingOrNewTab';
                    if (e.ctrlKey) {
                        mode = 'newTab';
                    } else if (e.shiftKey) {
                        mode = 'popup';
                    }

                    void this._api.commandExec(command, {mode: mode});
                    e.preventDefault();
                };
                /**
                 * @param {MouseEvent} e
                 */
                const onAuxClick = (e) => {
                    if (e.button !== 1) { return; }
                    void this._api.commandExec(command, {mode: 'newTab'});
                    e.preventDefault();
                };
                node.addEventListener('click', onClick, false);
                node.addEventListener('auxclick', onAuxClick, false);
            }

            if (typeof url === 'string') {
                node.href = url;
                node.target = '_blank';
                node.rel = 'noopener';
            }
        }
    }

    /** */
    async _setupEnvironment() {
        const urlSearchParams = new URLSearchParams(location.search);
        let mode = urlSearchParams.get('mode');
        switch (mode) {
            case 'full':
            case 'mini':
                break;
            default:
                {
                    let tab;
                    try {
                        tab = await this._getCurrentTab();
                        // Safari assigns a tab object to the popup, other browsers do not
                        if (tab && await this._isSafari()) {
                            tab = void 0;
                        }
                    } catch (e) {
                        // NOP
                    }
                    mode = (tab ? 'full' : 'mini');
                }
                break;
        }

        document.documentElement.dataset.mode = mode;
    }

    /**
     * @returns {Promise<chrome.tabs.Tab|undefined>}
     */
    _getCurrentTab() {
        return new Promise((resolve, reject) => {
            chrome.tabs.getCurrent((result) => {
                const e = chrome.runtime.lastError;
                if (e) {
                    reject(new Error(e.message));
                } else {
                    resolve(result);
                }
            });
        });
    }

    /**
     * @param {import('settings').Profile} profile
     */
    _setupOptions({options}) {
        const extensionEnabled = options.general.enable;
        const onToggleChanged = () => this._api.commandExec('toggleTextScanning');
        for (const toggle of /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll('.enable-search,.enable-search2'))) {
            if (toggle.checked !== extensionEnabled) {
                toggle.checked = extensionEnabled;
            }
            toggle.addEventListener('change', onToggleChanged, false);
        }
        void this._updateDisplayModifierKey();
        void this._updateDictionariesEnabledWarnings(options);
        void this._updatePermissionsWarnings(options);

        this._themeController.theme = options.general.popupTheme;
        this._themeController.siteOverride = true;
        this._themeController.updateTheme();
    }

    /** */
    async _setupHotkeys() {
        const hotkeyHelpController = new HotkeyHelpController();
        await hotkeyHelpController.prepare(this._api);

        const {profiles, profileCurrent} = /** @type {import('settings').Options} */ (this._optionsFull);
        const defaultProfile = (profileCurrent >= 0 && profileCurrent < profiles.length) ? profiles[profileCurrent] : null;
        if (defaultProfile !== null) {
            hotkeyHelpController.setOptions(defaultProfile.options);
        }

        hotkeyHelpController.setupNode(document.documentElement);
    }

    /**
     * @param {import('settings').Profile[]} profiles
     * @param {number} profileCurrent
     */
    _updateProfileSelect(profiles, profileCurrent) {
        /** @type {NodeListOf<HTMLSelectElement>} */
        const selects = document.querySelectorAll('.profile-select');
        /** @type {NodeListOf<HTMLElement>} */
        for (let i = 0; i < Math.min(selects.length); i++) {
            const fragment = document.createDocumentFragment();
            for (let j = 0, jj = profiles.length; j < jj; ++j) {
                const {name} = profiles[j];
                const option = document.createElement('option');
                option.textContent = name;
                option.value = `${j}`;
                fragment.appendChild(option);
            }
            selects[i].textContent = '';
            selects[i].appendChild(fragment);
            selects[i].value = `${profileCurrent}`;

            selects[i].addEventListener('change', this._onProfileSelectChange.bind(this), false);
        }
    }

    /**
     * @param {Event} event
     */
    _onProfileSelectChange(event) {
        const node = /** @type {HTMLInputElement} */ (event.currentTarget);
        const value = Number.parseInt(node.value, 10);
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < /** @type {import('settings').Options} */ (this._optionsFull).profiles.length) {
            const optionsFull = this._optionsFull;
            if (optionsFull && value < optionsFull.profiles.length) {
                void this._setDefaultProfileIndex(value);
                optionsFull.profileCurrent = value;
                const defaultProfile = optionsFull.profiles[optionsFull.profileCurrent];
                if (defaultProfile !== null) {
                    this._setupOptions(defaultProfile);
                }
            }
        }
    }

    /**
     * @param {number} value
     */
    async _setDefaultProfileIndex(value) {
        /** @type {import('settings-modifications').ScopedModificationSet} */
        const modification = {
            action: 'set',
            path: 'profileCurrent',
            value,
            scope: 'global',
            optionsContext: null,
        };
        await this._api.modifySettings([modification], 'action-popup');
    }

    /**
     * @param {import('settings').ProfileOptions} options
     */
    async _updateDictionariesEnabledWarnings(options) {
        const tooltip = document.querySelectorAll('.tooltip');
        const dictionaries = await this._api.getDictionaryInfo();

        const enabledDictionaries = new Set();
        for (const {name, enabled} of options.dictionaries) {
            if (enabled) {
                enabledDictionaries.add(name);
            }
        }

        let enabledCount = 0;
        for (const {title} of dictionaries) {
            if (enabledDictionaries.has(title)) {
                ++enabledCount;
            }
        }

        if (enabledCount === 0) {
            for (let i = 0; i < tooltip.length; i++) {
                tooltip[i].innerHTML = 'No dictionary enabled';
                tooltip[i].classList.add('enable-dictionary-tooltip');
            }
        }
    }

    /**
     * @param {import('settings').ProfileOptions} options
     */
    async _updatePermissionsWarnings(options) {
        const permissions = await getAllPermissions();
        if (hasRequiredPermissionsForOptions(permissions, options)) { return; }

        const tooltip = document.querySelectorAll('.tooltip');
        for (let i = 0; i < tooltip.length; i++) {
            tooltip[i].innerHTML = '<a class="action-open-permissions">Please enable permissions</a>';
        }
        this._setupButtonEvents('.action-open-permissions', null, chrome.runtime.getURL('/permissions.html'));
    }

    /** @returns {Promise<boolean>} */
    async _isSafari() {
        const {browser} = await this._api.getEnvironmentInfo();
        return browser === 'safari';
    }

    /**
     * @param {?import('settings').Profile} profile
     */
    async _runAnkiDebug(profile) {
        if (!await this._isSafari()) { return; }

        this._appendAnkiDebugLine('Toolbar action page loaded');
        this._appendAnkiDebugLine(`runtime.id: ${chrome.runtime.id}`);

        const options = profile?.options ?? null;
        if (options !== null) {
            this._appendAnkiDebugLine(`anki.enable: ${options.anki.enable}`);
            this._appendAnkiDebugLine(`anki.cardFormats: ${options.anki.cardFormats.length}`);
            this._appendAnkiDebugLine(`anki.server: ${options.anki.server}`);
            this._appendAnkiDebugLine(`popupDisplayMode: ${options.general.popupDisplayMode}`);
            this._appendAnkiDebugLine(`displayTagsAndFlags: ${options.anki.displayTagsAndFlags}`);
            this._appendAnkiDebugLine(`checkForDuplicates: ${options.anki.checkForDuplicates}`);
            this._appendAnkiDebugLine(`duplicateBehavior: ${options.anki.duplicateBehavior}`);
            for (const [index, cardFormat] of options.anki.cardFormats.entries()) {
                this._appendAnkiDebugLine(`cardFormat[${index}]: ${cardFormat.name} (${cardFormat.type}) deck=${cardFormat.deck} model=${cardFormat.model}`);
            }
        } else {
            this._appendAnkiDebugLine('No profile options available');
        }

        try {
            const permissions = await getAllPermissions();
            const nativeMessagingEnabled = Array.isArray(permissions.permissions) && permissions.permissions.includes('nativeMessaging');
            this._appendAnkiDebugLine(`nativeMessaging permission: ${nativeMessagingEnabled}`);
        } catch (e) {
            this._appendAnkiDebugLine(`permissions error: ${this._errorToString(e)}`);
        }

        try {
            const isConnected = await this._api.isAnkiConnected();
            this._appendAnkiDebugLine(`isAnkiConnected: ${isConnected}`);
        } catch (e) {
            this._appendAnkiDebugLine(`isAnkiConnected error: ${this._errorToString(e)}`);
        }

        try {
            const version = await this._api.getAnkiConnectVersion();
            this._appendAnkiDebugLine(`getAnkiConnectVersion: ${version}`);
        } catch (e) {
            this._appendAnkiDebugLine(`getAnkiConnectVersion error: ${this._errorToString(e)}`);
        }

        await this._runNativeAnkiBridgeDebug(options?.anki.server ?? 'http://127.0.0.1:8765');
    }

    /**
     * @param {string} message
     */
    _appendAnkiDebugLine(message) {
        if (this._ankiDebugPanel === null || this._ankiDebugLog === null) { return; }
        this._ankiDebugPanel.hidden = false;
        const timestamp = new Date().toLocaleTimeString();
        this._ankiDebugLog.textContent += `[${timestamp}] ${message}\n`;
    }

    /**
     * @param {unknown} error
     * @returns {string}
     */
    _errorToString(error) {
        if (error instanceof Error) {
            const data = /** @type {{data?: unknown}} */ (error).data;
            return typeof data !== 'undefined' ? `${error.message} | ${this._serializeErrorData(data)}` : error.message;
        }
        return `${error}`;
    }

    /**
     * @param {unknown} data
     * @returns {string}
     */
    _serializeErrorData(data) {
        try {
            return JSON.stringify(data);
        } catch (e) {
            return `${data}`;
        }
    }

    /**
     * @param {string} server
     */
    async _runNativeAnkiBridgeDebug(server) {
        const applications = [];
        const runtimeId = chrome.runtime.id;
        applications.push(runtimeId);
        applications.push(runtimeId.replace(/\s+\([^)]+\)$/, ''));
        applications.push('dev.yomitan.safari.extension');
        applications.push('dev.yomitan.safari');
        applications.push('yomitan_anki');

        for (const application of [...new Set(applications)].filter((value) => value.length > 0)) {
            try {
                const result = await this._sendNativeMessage(application, {
                    action: 'ankiRequest',
                    url: server,
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({action: 'version', params: {}, version: 2}),
                });
                this._appendAnkiDebugLine(`native ${application}: ${this._serializeErrorData(result)}`);
            } catch (e) {
                this._appendAnkiDebugLine(`native ${application} error: ${this._errorToString(e)}`);
            }
        }
    }

    /**
     * @param {string} application
     * @param {import('core').SerializableObject} message
     * @returns {Promise<unknown>}
     */
    _sendNativeMessage(application, message) {
        return new Promise((resolve, reject) => {
            let handled = false;
            const onResolve = (value) => {
                if (handled) { return; }
                handled = true;
                resolve(value);
            };
            const onReject = (error) => {
                if (handled) { return; }
                handled = true;
                reject(error instanceof Error ? error : new Error(`${error}`));
            };

            try {
                const maybePromise = chrome.runtime.sendNativeMessage(application, message, (response) => {
                    const runtimeError = chrome.runtime.lastError;
                    if (runtimeError) {
                        onReject(new Error(runtimeError.message));
                    } else {
                        onResolve(response);
                    }
                });

                if (typeof maybePromise === 'object' && maybePromise !== null && typeof maybePromise.then === 'function') {
                    maybePromise.then(onResolve, onReject);
                }
            } catch (e) {
                onReject(e);
            }
        });
    }
}

await Application.main(true, async (application) => {
    void application.api.logIndicatorClear();

    const displayController = new DisplayController(application.api);
    await displayController.prepare();
});
