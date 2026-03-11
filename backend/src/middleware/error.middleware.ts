import { FastifyError, FastifyRequest, FastifyReply } from 'fastify';

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
) {
  request.log.error(error);
  
  // Validation errors
  if (error.validation) {
    return reply.code(400).send({
      error: 'Validation Error',
      details: error.validation,
    });
  }
  
  // Known errors
  if (error.statusCode && error.statusCode < 500) {
    return reply.code(error.statusCode).send({
      error: error.message,
    });
  }
  
  // Internal errors (don't leak details)
  return reply.code(500).send({
    error: 'Internal Server Error',
  });
}
