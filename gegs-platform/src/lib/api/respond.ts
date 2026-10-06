import { NextResponse } from 'next/server';
import { REQUEST_ID_HEADER } from '@/lib/request-id';
import { type ApiErrorBody, ApiError, statusForCode, toErrorBody } from '@/lib/api/errors';

export interface ApiSuccessBody<T> {
  data: T;
  meta: { request_id: string };
}

export function ok<T>(
  data: T,
  requestId: string,
  init?: ResponseInit,
): NextResponse<ApiSuccessBody<T>> {
  return NextResponse.json(
    { data, meta: { request_id: requestId } },
    { ...init, headers: { ...(init?.headers ?? {}), [REQUEST_ID_HEADER]: requestId } },
  );
}

export function fail(error: unknown, requestId: string): NextResponse<ApiErrorBody> {
  const body = toErrorBody(error, requestId);
  const status = error instanceof ApiError ? statusForCode(error.code) : 500;
  return NextResponse.json(body, {
    status,
    headers: { [REQUEST_ID_HEADER]: requestId },
  });
}
