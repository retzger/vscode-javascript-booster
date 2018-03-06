import * as assert from 'assert';
import * as vscode from 'vscode';
import * as jscodeshift from 'jscodeshift';
import { defineTransformTest, defineCanRunTest } from '../utils/testHelpers';

defineTransformTest(__dirname, 'magic');
