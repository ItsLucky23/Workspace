import * as vsctm from 'vscode-textmate';
import { loadWASM, OnigScanner, OnigString } from 'vscode-oniguruma';
import * as monaco from 'monaco-editor';
// import wasmURL from 'vscode-oniguruma/release/onig.wasm?url';
import { IColorTheme, TMToMonacoToken } from './tm-to-monaco-token';

export {
  convertTheme,
  type IVScodeTheme,
  type TokenColor,
} from './theme-converter';

const wasmPromise = fetch("public/onig.wasm") // put in /public folder
  .then((response) => response.arrayBuffer())
  .then((buffer) => loadWASM({ data: buffer }))
  .catch((error) => console.error('Failed to load `onig.wasm`:', error));

// const scopeUrlMap: Record<string, string> = {
//   'source.ts':
//     'https://raw.githubusercontent.com/microsoft/vscode/main/extensions/typescript-basics/syntaxes/TypeScript.tmLanguage.json',
// };
const scopeUrlMap: Record<string, string> = {
  'source.ts': 'https://raw.githubusercontent.com/microsoft/vscode/main/extensions/typescript-basics/syntaxes/TypeScript.tmLanguage.json',
  'source.tsx': '/TypeScriptReact.tmLanguage.json', // or a raw URL if you prefer
};

const registry = new vsctm.Registry({
  onigLib: wasmPromise.then(() => {
    return {
      createOnigScanner: (sources) => new OnigScanner(sources),
      createOnigString: (str) => new OnigString(str),
    };
  }),
  loadGrammar(scopeName) {
    function fetchGrammar(path: string) {
      return fetch(path).then((response) => response.text());
    }

    const url = scopeUrlMap[scopeName];
    if (url) {
      return fetchGrammar(url).then((grammar) => JSON.parse(grammar));
    }

    return Promise.reject(
      new Error(`No grammar found for scope: ${scopeName}`)
    );
  },
});

async function createTokensProvider(
  scopeName: string,
  editor?:
    | (monaco.editor.IStandaloneCodeEditor & { _themeService?: any })
    | undefined,
  colorTheme?: IColorTheme
): Promise<monaco.languages.TokensProvider> {

  const grammar = await registry.loadGrammar(scopeName);
  if (!grammar) throw new Error('Failed to load grammar');

  if (!colorTheme) {
    colorTheme = {
      tokenColors: [],
    };
  }


  return {
    getInitialState: () => vsctm.INITIAL,
    tokenize(line, state: vsctm.StateStack) {
      const lineTokens = grammar.tokenizeLine(line, state);
      const tokens: monaco.languages.IToken[] = [];

      for (const token of lineTokens.tokens) {
        const resolvedToken = TMToMonacoToken(colorTheme, token.scopes);
        tokens.push({
          startIndex: token.startIndex,
          scopes: resolvedToken,
        });
      }

      return { tokens, endState: lineTokens.ruleStack };
    },
  };
}

class TokensProviderCache {
  private cache: Record<string, monaco.languages.TokensProvider> = {};

  constructor(
    private editor?: monaco.editor.IStandaloneCodeEditor | undefined,
    private colorTheme?: IColorTheme
  ) { }

  async getTokensProvider(
    scopeName: string
  ): Promise<monaco.languages.TokensProvider> {
    if (!this.cache[scopeName]) {
      this.cache[scopeName] = await createTokensProvider(
        scopeName,
        this.editor,
        this.colorTheme
      );
    }

    return this.cache[scopeName];
  }
}

export { TokensProviderCache };