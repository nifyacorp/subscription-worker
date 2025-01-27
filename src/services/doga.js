export class DogaParserClient {
  constructor() {
    this.baseUrl = process.env.DOGA_PARSER_URL;
  }

  async getLatestContent() {
    const response = await fetch(`${this.baseUrl}/latest`);
    if (!response.ok) {
      throw new Error(`Failed to fetch DOGA content: ${response.statusText}`);
    }
    return response.json();
  }

  async analyze(content, prompt) {
    const response = await fetch(`${this.baseUrl}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content, prompt }),
    });

    if (!response.ok) {
      throw new Error(`Failed to analyze content: ${response.statusText}`);
    }

    return response.json();
  }
}