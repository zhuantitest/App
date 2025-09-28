// src/utils/errorHandler.ts
// 標準化錯誤處理工具

export interface ApiError {
  code: string;
  message: string;
  details?: any;
  timestamp: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: ApiError;
  message?: string;
}

export class AppError extends Error {
  public code: string;
  public statusCode: number;
  public details?: any;

  constructor(message: string, code: string = 'UNKNOWN_ERROR', statusCode: number = 500, details?: any) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.name = 'AppError';
  }
}

// 預定義錯誤類型
export const ErrorCodes = {
  // 認證相關
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  
  // 驗證相關
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_FORMAT: 'INVALID_FORMAT',
  
  // 資源相關
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  RESOURCE_CONFLICT: 'RESOURCE_CONFLICT',
  
  // 業務邏輯
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  CATEGORY_NOT_FOUND: 'CATEGORY_NOT_FOUND',
  
  // 外部服務
  OCR_SERVICE_ERROR: 'OCR_SERVICE_ERROR',
  AI_SERVICE_ERROR: 'AI_SERVICE_ERROR',
  EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR',
  
  // 系統錯誤
  DATABASE_ERROR: 'DATABASE_ERROR',
  FILE_UPLOAD_ERROR: 'FILE_UPLOAD_ERROR',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
} as const;

// 標準化錯誤回應
export function createErrorResponse(
  code: string,
  message: string,
  statusCode: number = 500,
  details?: any
): ApiResponse {
  return {
    success: false,
    error: {
      code,
      message,
      details,
      timestamp: new Date().toISOString(),
    },
  };
}

// 標準化成功回應
export function createSuccessResponse<T>(data: T, message?: string): ApiResponse<T> {
  return {
    success: true,
    data,
    message,
  };
}

// 全域錯誤處理中介層
export function errorHandler(err: any, req: any, res: any, next: any) {
  console.error('Error occurred:', err);

  // 如果是自定義錯誤
  if (err instanceof AppError) {
    return res.status(err.statusCode).json(createErrorResponse(
      err.code,
      err.message,
      err.statusCode,
      err.details
    ));
  }

  // 如果是 Prisma 錯誤
  if (err.code && err.code.startsWith('P')) {
    return res.status(400).json(createErrorResponse(
      ErrorCodes.DATABASE_ERROR,
      '資料庫操作失敗',
      400,
      { prismaCode: err.code }
    ));
  }

  // 如果是驗證錯誤
  if (err.name === 'ValidationError') {
    return res.status(400).json(createErrorResponse(
      ErrorCodes.VALIDATION_ERROR,
      '資料驗證失敗',
      400,
      err.details
    ));
  }

  // 預設錯誤
  return res.status(500).json(createErrorResponse(
    ErrorCodes.INTERNAL_SERVER_ERROR,
    '伺服器內部錯誤',
    500
  ));
}

// 非同步錯誤包裝器
export function asyncHandler(fn: Function) {
  return (req: any, res: any, next: any) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// 常用錯誤建立函數
export const createAppError = {
  unauthorized: (message: string = '未授權存取') => 
    new AppError(message, ErrorCodes.UNAUTHORIZED, 401),
  
  notFound: (resource: string = '資源') => 
    new AppError(`${resource}不存在`, ErrorCodes.NOT_FOUND, 404),
  
  validationError: (message: string, details?: any) => 
    new AppError(message, ErrorCodes.VALIDATION_ERROR, 400, details),
  
  conflict: (message: string) => 
    new AppError(message, ErrorCodes.RESOURCE_CONFLICT, 409),
  
  externalServiceError: (service: string, details?: any) => 
    new AppError(`${service}服務錯誤`, ErrorCodes.EXTERNAL_API_ERROR, 502, details),
};
