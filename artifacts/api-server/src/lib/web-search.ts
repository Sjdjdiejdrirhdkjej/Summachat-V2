import Exa from "exa-js";

export type SearchResult = {
  title: string;
  url: string;
  text: string;
};

let _exaClient: Exa | null = null;

function getExaClient(): Exa {
  if (!_exaClient) {
    _exaClient = new Exa(process.env["EXA_API_KEY"]);
  }
  return _exaClient;
}

export async function searchWeb(query: string): Promise<SearchResult[]> {
  const exa = getExaClient();
  const result = await exa.searchAndContents(query, {
    type: "auto",
    numResults: 5,
    text: { maxCharacters: 1500 },
  });

  return result.results.map((item) => {
    const maybeText = (item as { text?: unknown }).text;
    return {
      title: item.title ?? "",
      url: item.url,
      text: typeof maybeText === "string" ? maybeText : "",
    };
  });
}

export function buildWebContext(results: SearchResult[]): string {
  const block = results
    .map(
      (result, index) =>
        `[${index + 1}] ${result.title}\nURL: ${result.url}\n${result.text.trim()}`,
    )
    .join("\n\n---\n\n");

  return `The following are live web search results relevant to the user's question. Use them to inform your answer where appropriate:\n\n${block}\n\n---\n\nUser question:`;
}
