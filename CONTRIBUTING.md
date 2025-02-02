# Contributing to VSCode Javascript Booster

## Debugging the extension

-   Compile the language server using `npm run compile` in the server/ directory.
-   Launch `Launch client (client)`. You can debug the extension code now.
-   If needed, launch `Attach to Server (server)` in parallel. Now you can debug both the language server and the extension.

## Running tests (dev mode)

Language server:

-   run `npm test -- --watch` inside the `server` directory to run the language server tests.
-   launch `Server Tests (server)` to debug the tests.

Extension (client):

-   run `npm test` inside the `client` directory to run the extension integration tests.
-   launch `Extension tests (client)` to debug the tests.

## Packaging extension for testing locally

`vsce` (Visual Studio Code Extensions) CLI has to be installed in order to build the extension locally (`npm i -g vsce`).

The following set of commands build the extension package:

-   in the root dir: `npm run compile`
-   in the client dir: `vsce package`

After the build, run VSCode, go to the extensions tab and choose 'Install from VSIX...'. If the extension is already installed, it will be overwritten.

## Pre-flight checklist

All releases are made using release branches, e.g. `release/0.11.0`.

-   Update README.md:
    -   Add new changelog entry
    -   Add new code actions into the list
    -   Check if other changes are needed
-   Place all the resources (gifs, etc) into the `resources` dir.
-   Run `npm run generate:docs` to update extension's readme and changelog files.
-   Initiate new release by running the command (in the root dir): `npm version [patch|minor|major]`
-   Merge the release branch into master, delete it and push

## Useful links

-   https://astexplorer.net/ - Explore code as an abstract syntax tree. Select Babylon7 parser to see the right tree. Helps when writing new code actions.
-   https://github.com/facebook/jscodeshift - The engine behind this extension: a set of high-level tools to operate an AST.
-   https://github.com/benjamn/recast - The library used by jscodeshift to mutate and pretty-print the code.
-   https://github.com/benjamn/ast-types - The library under the hood of recast and jscodeshift.
