/** Erro de regra de negócio, devolvido ao cliente HTTP com código estável. */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 422,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class NotFoundError extends DomainError {
  constructor(what: string) {
    super('NOT_FOUND', `${what} não encontrado`, 404);
  }
}
