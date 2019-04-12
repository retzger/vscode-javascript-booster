/**
 * Developer: Stepan Burguchev
 * Date: 11/16/2017
 * Copyright: 2015-present ApprovalMax
 *       All Rights Reserved
 *
 * THIS IS UNPUBLISHED PROPRIETARY SOURCE CODE OF ApprovalMax
 *       The copyright notice above does not evidence any
 *       actual or intended publication of such source code.
 */

import * as assert from 'assert';
import * as fs from 'fs-extra';
import * as _ from 'lodash';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode-languageserver-types';

import astService, { LanguageId } from '../../src/services/astService';
import codeModService from '../../src/services/codeModService';
import { IPosition, Position } from '../../src/utils/Position';

function toZeroBasedPosition(pos: IPosition) {
    return vscode.Position.create(pos.line - 1, pos.column - 1);
}

function toOffsetFromStart(input: string, posOneBased: IPosition): number {
    const pos = toZeroBasedPosition(posOneBased);
    let offset = 0;
    const lines = input.split('\n');
    const prevLines = lines.slice(0, pos.line);
    offset += prevLines.map(l => l.length + os.EOL.length).reduce((s, a) => s + a, 0);
    offset += pos.character;
    return offset;
}

function getSelection(options: { input: string; anchor?: IPosition; active: IPosition }) {
    return {
        anchor: toOffsetFromStart(options.input, options.anchor || options.active),
        active: toOffsetFromStart(options.input, options.active)
    };
}

function normalizeLineEndings(text: string) {
    return text.split('\r').join('');
}

async function runInlineTransformTest(
    languageId: LanguageId,
    modId: string,
    input: string,
    output: {
        source: string;
        selection?: {
            anchor?: IPosition;
            active: IPosition;
        };
    },
    options: {
        fileName?: string;
        anchor?: IPosition;
        active: IPosition;
    }
) {
    input = normalizeLineEndings(input);
    const expectedOutput = normalizeLineEndings(output.source);
    codeModService.loadOneEmbeddedCodeMod(modId);

    const runOptions = {
        languageId,
        fileName:
            (options && options.fileName) || '/Users/billy/projects/example/codemods/example.ts',
        source: input,
        selection: getSelection({
            input,
            anchor: options.anchor,
            active: options.active
        }),
        include: [modId]
    };

    const canRun = (await codeModService.getRunnableCodeMods(runOptions)).length === 1;
    if (!canRun) {
        throw new Error('The transform cannot be run at this position.');
    }
    let result = codeModService.executeTransform(modId, runOptions);
    const actualOutput = normalizeLineEndings(result.source);

    // Wrong result in execute()
    expect(actualOutput).toBe(expectedOutput);

    if (output.selection) {
        // execute() must return new selection
        expect(result.selection).toBeTruthy();
        const actualActivePos = Position.fromZeroBased(
            astService.positionAt(result.source, result.selection!.active)
        );
        const actualAnchorPos = Position.fromZeroBased(
            astService.positionAt(result.source, result.selection!.anchor)
        );
        const expectedActivePos = new Position(
            output.selection.active.line,
            output.selection.active.column
        );
        const expectedAnchorPos = output.selection.anchor || expectedActivePos;
        // Wrong output selection
        expect(actualActivePos).toEqual(expectedActivePos);
        expect(actualAnchorPos).toEqual(expectedAnchorPos);
    }
}

async function runInlineCanRunTest(
    languageId: LanguageId,
    modId: string,
    input: string,
    expected: boolean,
    options: { fileName?: string; anchor?: IPosition; active: IPosition }
) {
    codeModService.loadOneEmbeddedCodeMod(modId);

    const runOptions = {
        languageId,
        fileName: (options && options.fileName) || '/Users/example/example.ts',
        source: input,
        selection: getSelection({
            input,
            anchor: options.anchor,
            active: options.active
        }),
        include: [modId]
    };

    const actualCanRun = (await codeModService.getRunnableCodeMods(runOptions)).length === 1;
    // canRun test fail
    expect(actualCanRun).toBe(expected);
}

function getLanguageIdByFileName(fileName: string): LanguageId {
    const extensionMap: Array<{
        extensions: string;
        parser: LanguageId;
    }> = [
        {
            extensions: '.js,.es,.es6',
            parser: 'javascript'
        },
        {
            extensions: '.jsx',
            parser: 'javascriptreact'
        },
        {
            extensions: '.ts',
            parser: 'typescript'
        },
        {
            extensions: '.tsx',
            parser: 'typescriptreact'
        }
    ];
    const fileExt = path.extname(fileName);
    const def = extensionMap.find(x => x.extensions.split(',').indexOf(fileExt) !== -1);
    if (!def) {
        throw new Error(`Failed to match file extension of file '${fileName}' to languageId.`);
    }
    return def.parser;
}

function extractPosition(modId: string, source: string): (IPosition & { source: string }) | null {
    const re = /\/\*#\s*([^#]+?)\s*#\*\//g;
    const reClean = /\s*\/\*#\s*([^#]+?)\s*#\*\//g;
    const match = re.exec(source);
    if (!match || !match[0]) {
        return null;
    }
    // tslint:disable-next-line:no-eval
    const posDef = eval('(' + match[1] + ')');
    if (!Number.isFinite(posDef.pos)) {
        throw new Error(`Invalid 'pos' definition in positional comment:\n"${source}"`);
    }
    const column: number = posDef.pos;
    let line: number = source.split('\n').findIndex(l => l.includes(match[0])) + 1;
    if (posDef.nextLine) {
        line++;
    }

    let cleanSource = source.replace(reClean, '');
    if (cleanSource.startsWith('\n')) {
        cleanSource = cleanSource.substring(1);
        line--;
    }

    return {
        source: cleanSource,
        line,
        column
    };
}

function extractFixtures(
    modId: string,
    input: string,
    fallbackFixtureName: string | null = null,
    hasPosition: boolean = true
) {
    const re = /\/\*\$\s*([^\$]+?)\s*\$\*\//g; // /*$ VALUE $*/
    let match;
    interface FixtureRawDef {
        raw: any;
        name: string;
        skip?: boolean;
        validateOutPos?: boolean;
        inputStart: number;
        inputEnd: number;
    }
    const fixtures: FixtureRawDef[] = [];
    let activeFixture: FixtureRawDef | undefined;
    // tslint:disable-next-line:no-conditional-assignment
    while ((match = re.exec(input)) !== null) {
        let fixtureDef;
        try {
            // tslint:disable-next-line:no-eval
            fixtureDef = eval('(' + match[1] + ')');
        } catch (e) {
            throw new Error(`[${modId}] Failed to parse inline fixture definition.`);
        }
        if (activeFixture) {
            activeFixture.inputEnd = re.lastIndex - match[0].length;
            fixtures.push(activeFixture);
        }
        activeFixture = {
            raw: fixtureDef,
            name: fixtureDef.fixture as string,
            skip: fixtureDef.skip,
            validateOutPos: fixtureDef.validateOutPos,
            inputStart: re.lastIndex,
            inputEnd: input.length
        };
    }
    if (activeFixture) {
        fixtures.push(activeFixture);
    }
    const fullFixtures: Array<{
        raw: any;
        name: string | null;
        validateOutPos: boolean;
        skip: boolean;
        source: string;
        pos: IPosition;
    }> = fixtures.map(fx => {
        const inputFragment = input.substring(fx.inputStart, fx.inputEnd);
        let source = inputFragment.trim();
        let pos = extractPosition(modId, source);
        if (pos) {
            source = pos.source;
        }
        if (!pos && (hasPosition || fx.validateOutPos)) {
            throw new Error(
                `[${modId}][${fx.name ||
                    ''}] Position is not provided, use '/*# { position: columnNumber[, nextLine: true] } #*/'`
            );
        }

        return {
            raw: fx.raw,
            name: fx.name,
            validateOutPos: Boolean(fx.validateOutPos),
            skip: fx.skip || false,
            source,
            pos: pos || new Position(1, 1)
        };
    });
    if (fullFixtures.length === 0) {
        let source = input.trim();
        let pos = extractPosition(modId, source);
        if (pos) {
            source = pos.source;
        }
        if (!pos && hasPosition) {
            throw new Error(
                `[${modId}][${fallbackFixtureName}] Position is not provided, use '/*# { position: columnNumber[, nextLine: true] } #*/'`
            );
        }

        fullFixtures.push({
            raw: {},
            name: fallbackFixtureName,
            validateOutPos: false,
            skip: false,
            source,
            pos: pos || new Position(1, 1)
        });
    }
    return fullFixtures;
}

function defineTransformTests(
    dirName: string,
    modId: string,
    fixtureId: string | null = null,
    options: { fileName?: string; pos?: IPosition; startPos?: IPosition; endPos?: IPosition } = {}
) {
    const fixDir = path.join(dirName, '__codemod-fixtures__');
    const fixtureSuffix = fixtureId ? `.${fixtureId}` : '';
    const files = fs.readdirSync(fixDir);
    const inputFile = files.find(file => file.startsWith(`${modId}${fixtureSuffix}.input.`));
    const outputFile = files.find(file => file.startsWith(`${modId}${fixtureSuffix}.output.`));
    if (!inputFile || !outputFile) {
        throw new Error(
            `Failed to find input or output fixture. modId: '${modId}', fixtureId: ${fixtureId}.`
        );
    }
    const input = fs.readFileSync(path.join(fixDir, inputFile), 'utf8');
    const output = fs.readFileSync(path.join(fixDir, outputFile), 'utf8');

    const inputFixtures = extractFixtures(modId, input, fixtureId, true);
    const outputFixtures = extractFixtures(modId, output, fixtureId, false);

    describe(`${modId} transform`, () => {
        inputFixtures.forEach(fx => {
            const testName = fx.name
                ? `"${modId}:${fx.name}" transforms correctly (pos ${fx.pos.line}:${fx.pos.column})`
                : `"${modId}" transforms correctly (pos ${fx.pos.line}:${fx.pos.column})`;
            const outputFx = outputFixtures.find(x => x.name === fx.name);
            if (!outputFx) {
                throw new Error(`Failed to find output data for fixture ${fx.name}, mod ${modId}.`);
            }
            const fn = fx.skip ? it.skip : it;
            fn(testName, async () => {
                await runInlineTransformTest(
                    getLanguageIdByFileName(inputFile),
                    modId,
                    fx.source,
                    {
                        source: outputFx.source,
                        selection: outputFx.validateOutPos
                            ? {
                                  active: outputFx.pos
                              }
                            : undefined
                    },
                    {
                        fileName: options.fileName,
                        active: fx.pos
                    }
                );
            });
        });
    });
}

function defineCanRunTests(
    dirName: string,
    modId: string,
    fixtureId: string | null = null,
    options: { fileName?: string; pos?: IPosition; startPos?: IPosition; endPos?: IPosition } = {}
) {
    const fixDir = path.join(dirName, '__codemod-fixtures__');
    const fixtureSuffix = fixtureId ? `.${fixtureId}` : '';
    const files = fs.readdirSync(fixDir);
    const inputFile = files.find(file => file.startsWith(`${modId}${fixtureSuffix}.check.`));
    if (!inputFile) {
        throw new Error(
            `Failed to find the input fixture for canRun() test. modId: '${modId}', fixtureId: ${fixtureId}.`
        );
    }
    const input = fs.readFileSync(path.join(fixDir, inputFile), 'utf8');
    const inputFixtures = extractFixtures(modId, input, fixtureId, true);

    describe(`${modId} can run`, () => {
        inputFixtures.forEach(fx => {
            if (typeof fx.raw.expected !== 'boolean') {
                throw new Error(
                    `Invalid type of 'expected' property in fixture ${fx.name}, mod ${modId}.`
                );
            }
            const expected: boolean = fx.raw.expected;
            const testName = fx.name
                ? `"${modId}:${fx.name}" ${expected ? 'can' : 'cannot'} run (pos ${fx.pos.line}:${
                      fx.pos.column
                  })`
                : `"${modId}" ${expected ? 'can' : 'cannot'} run (pos ${fx.pos.line}:${
                      fx.pos.column
                  })`;
            const fn = fx.skip ? it.skip : it;
            fn(testName, async () => {
                await runInlineCanRunTest(
                    getLanguageIdByFileName(inputFile),
                    modId,
                    fx.source,
                    expected,
                    {
                        fileName: options.fileName,
                        active: fx.pos
                    }
                );
            });
        });
    });
}

export function defineCodeModTests(dirName: string) {
    const fixDir = path.join(dirName, '__codemod-fixtures__');
    const files = fs.readdirSync(fixDir);
    const modIds = _.uniq(files.map(f => f.substring(0, f.indexOf('.'))));

    modIds.forEach(modId => {
        defineCanRunTests(dirName, modId);
        defineTransformTests(dirName, modId);
    });
}
