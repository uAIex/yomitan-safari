# Yomitan

Need a clipboard inserter? see [https://gist.github.com/uAIex/576ffe80772fdd14c08a87a3fd8c6ffb](https://gist.github.com/uAIex/576ffe80772fdd14c08a87a3fd8c6ffb)

## Building

1. Install [Node.js](https://nodejs.org/) and [npm](https://www.npmjs.com/).
2. Run `npm ci`.
3. Run `npm run license-report:html`.
4. Run `npm run build`.
5. Build output is written to `builds/`.

## Safari on macOS

Run:

```sh
./build-safari.sh --version 26.2.17.0
```

This generates:

- `builds/yomitan-safari-web-extension`
- `builds/yomitan-safari-app`

Open the generated Xcode project:

- `builds/yomitan-safari-app/Yomitan Safari/Yomitan Safari.xcodeproj`

In Xcode:

1. Select the `Yomitan Safari` scheme.
2. Set the destination to `My Mac`.
3. In Signing & Capabilities, set the same Developer Team on both `Yomitan Safari` and `Yomitan Safari Extension`.
4. Build and run the app.
5. If needed, you can run without enabling developer mode by signing both targets and using the signed app directly.

## Scanning

- Scanning is tracked per tab.
- Press your configured main scan modifier key once to enable auto scan for the current tab.
- Press the same modifier key again to disable auto scan for that tab.
- On Safari for macOS, Live Text in images is supported when you select the text with the mouse.
