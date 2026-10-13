export class SearchInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SearchInputError';
    this.code = code;
  }
}
