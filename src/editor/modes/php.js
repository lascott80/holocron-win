// PHP for code blocks: snippets starting with `<?php` parse as a template,
// anything else as plain PHP (most notes omit the open tag). $variables get
// the special-variable colour, as in most editors.
import { phpLanguage } from "@codemirror/lang-php";
import { Language, LanguageSupport } from "@codemirror/language";
import { Parser } from "@lezer/common";
import { styleTags, tags as t } from "@lezer/highlight";

const props = [styleTags({ VariableName: t.special(t.variableName) })];
const template = phpLanguage.configure({ props, top: "Template" }).parser;
const plain = phpLanguage.configure({ props, top: "Program" }).parser;

class PhpParser extends Parser {
  createParse(input, fragments, ranges) {
    const from = ranges[0].from;
    const head = input.read(from, Math.min(input.length, from + 200));
    return (/^\s*<\?/.test(head) ? template : plain).createParse(input, fragments, ranges);
  }
}

export const php = () => new LanguageSupport(new Language(phpLanguage.data, new PhpParser(), [], "php"));
