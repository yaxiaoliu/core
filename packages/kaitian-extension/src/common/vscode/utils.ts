import type { OnEnterRule, IndentationRule } from '@ali/monaco-editor-core/esm/vs/editor/common/modes/languageConfiguration';
import type { WorkspaceEdit } from '@ali/monaco-editor-core/esm/vs/editor/common/modes';

import * as vscode from 'vscode';
import * as types from './ext-types';
import { SerializedIndentationRule, SerializedRegExp, SerializedOnEnterRule, ResourceTextEditDto, WorkspaceEditDto, ResourceFileEditDto } from './model.api';
import { Uri } from '@ali/ide-core-common';

/**
 * Returns `true` if the parameter has type "object" and not null, an array, a regexp, a date.
 */
// tslint:disable-next-line:no-any
export function isObject(obj: any): boolean {
  return typeof obj === 'object'
      && obj !== null
      && !Array.isArray(obj)
      && !(obj instanceof RegExp)
      && !(obj instanceof Date);
}

// tslint:disable-next-line:no-any
export function mixin(destination: any, source: any, overwrite: boolean = true): any {
  if (!isObject(destination)) {
      return source;
  }

  if (isObject(source)) {
      Object.keys(source).forEach((key) => {
          if (key in destination) {
              if (overwrite) {
                  if (isObject(destination[key]) && isObject(source[key])) {
                      mixin(destination[key], source[key], overwrite);
                  } else {
                      destination[key] = source[key];
                  }
              }
          } else {
              destination[key] = source[key];
          }
      });
  }
  return destination;
}

export function illegalArgument(message?: string): Error {
    if (message) {
        return new Error(`Illegal argument: ${message}`);
    } else {
        return new Error('Illegal argument');
    }
}

/* tslint:disable-next-line:no-any */
export function isLocationArray(array: any): array is types.Location[] {
    return Array.isArray(array) && array.length > 0 && array[0] instanceof types.Location;
}

/* tslint:disable-next-line:no-any */
export function isDefinitionLinkArray(array: any): array is vscode.DefinitionLink[] {
    return Array.isArray(array) && array.length > 0 && array[0].hasOwnProperty('targetUri') && array[0].hasOwnProperty('targetRange');
}

export function reviveRegExp(regExp?: SerializedRegExp): RegExp | undefined {
    if (typeof regExp === 'undefined' || regExp === null) {
        return undefined;
    }
    return new RegExp(regExp.pattern, regExp.flags);
}

export function reviveIndentationRule(indentationRule?: SerializedIndentationRule): IndentationRule | undefined {
    if (typeof indentationRule === 'undefined' || indentationRule === null) {
        return undefined;
    }
    return {
        increaseIndentPattern: reviveRegExp(indentationRule.increaseIndentPattern)!,
        decreaseIndentPattern: reviveRegExp(indentationRule.decreaseIndentPattern)!,
        indentNextLinePattern: reviveRegExp(indentationRule.indentNextLinePattern),
        unIndentedLinePattern: reviveRegExp(indentationRule.unIndentedLinePattern),
    };
}

export function reviveOnEnterRule(onEnterRule: SerializedOnEnterRule): OnEnterRule {
    return {
        beforeText: reviveRegExp(onEnterRule.beforeText)!,
        afterText: reviveRegExp(onEnterRule.afterText),
        action: onEnterRule.action,
    };
}

export function reviveOnEnterRules(onEnterRules?: SerializedOnEnterRule[]): OnEnterRule[] | undefined {
    if (typeof onEnterRules === 'undefined' || onEnterRules === null) {
        return undefined;
    }
    return onEnterRules.map(reviveOnEnterRule);
}

export function reviveWorkspaceEditDto(data: WorkspaceEditDto): WorkspaceEdit {
    if (data && data.edits) {
        for (const edit of data.edits) {
            if (typeof ( edit as ResourceTextEditDto).resource === 'object') {
                ( edit as ResourceTextEditDto).resource = Uri.revive(( edit as ResourceTextEditDto).resource);
            } else {
                ( edit as ResourceFileEditDto).newUri = Uri.revive(( edit as ResourceFileEditDto).newUri);
                ( edit as ResourceFileEditDto).oldUri = Uri.revive(( edit as ResourceFileEditDto).oldUri);
            }
        }
    }
    return  data as WorkspaceEdit;
}

export function serializeEnterRules(rules?: vscode.OnEnterRule[]): SerializedOnEnterRule[] | undefined {
    if (typeof rules === 'undefined' || rules === null) {
        return undefined;
    }

    return rules.map((r) =>
        ({
            action: r.action,
            beforeText: serializeRegExp(r.beforeText),
            afterText: serializeRegExp(r.afterText),
        } as SerializedOnEnterRule));
}

export function serializeRegExp(regexp?: RegExp): SerializedRegExp | undefined {
    if (typeof regexp === 'undefined' || regexp === null) {
        return undefined;
    }

    return {
        pattern: regexp.source,
        flags: (regexp.global ? 'g' : '') + (regexp.ignoreCase ? 'i' : '') + (regexp.multiline ? 'm' : ''),
    };
}

export function serializeIndentation(indentationRules?: vscode.IndentationRule): SerializedIndentationRule | undefined {
    if (typeof indentationRules === 'undefined' || indentationRules === null) {
        return undefined;
    }

    return {
        increaseIndentPattern: serializeRegExp(indentationRules.increaseIndentPattern),
        decreaseIndentPattern: serializeRegExp(indentationRules.decreaseIndentPattern),
        indentNextLinePattern: serializeRegExp(indentationRules.indentNextLinePattern),
        unIndentedLinePattern: serializeRegExp(indentationRules.unIndentedLinePattern),
    };
}
