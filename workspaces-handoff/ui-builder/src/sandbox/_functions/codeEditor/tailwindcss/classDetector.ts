export function isInsideClassName(text: string) {
  // 1. Find className=
  const attrMatch = text.match(/className\s*=\s*/);
  if (!attrMatch || attrMatch.index === undefined) return false;

  const afterAttr = text.slice(attrMatch.index + attrMatch[0].length);

  // 2. Check first character after =
  const first = afterAttr.trimStart()[0];

  // Case A: quote directly => className="..."
  if (first === `"` || first === `'` || first === "`") {
    return isInsideUnclosedString(afterAttr);
  }

  // Case B: expression => className={ ... }
  if (first === "{") {
    // We look *inside* the expression for an unclosed string
    const inside = afterAttr.slice(afterAttr.indexOf("{") + 1);
    return isInsideUnclosedString(inside);
  }

  return false;
}

function isInsideUnclosedString(text: string) {
  // Find first quote of any type
  const m = text.match(/["'`]/);
  if (!m) return false;

  const quote = m[0];
  const start = text.indexOf(quote);

  // After the opening quote
  const rest = text.slice(start + 1);

  // If we haven't seen the same quote again -> open string
  return !rest.includes(quote);
}