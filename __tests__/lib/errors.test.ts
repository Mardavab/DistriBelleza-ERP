import {
  AppError,
  err,
  handleActionError,
  isAppError,
  isFailure,
  isSuccess,
  warnSilently,
  withErrorLogging,
} from '../../lib/errors';

describe('AppError', () => {
  it('preserves code, message and userMessage', () => {
    const e = new AppError('VALIDATION', 'sku required', {
      userMessage: 'Falta el código del producto',
    });
    expect(e.code).toBe('VALIDATION');
    expect(e.message).toBe('sku required');
    expect(e.userMessage).toBe('Falta el código del producto');
    expect(e.name).toBe('AppError');
  });

  it('falls back to default userMessage when not provided', () => {
    const e = new AppError('FORBIDDEN', 'not owner');
    expect(e.userMessage).toContain('permisos');
  });

  it('toJSON returns a serializable shape', () => {
    const e = new AppError('CONFLICT', 'duplicate', { userMessage: 'Duplicado.' });
    expect(e.toJSON()).toEqual({
      code: 'CONFLICT',
      message: 'duplicate',
      userMessage: 'Duplicado.',
    });
  });

  it('isAppError detects instances', () => {
    expect(isAppError(new AppError('UNKNOWN', 'x'))).toBe(true);
    expect(isAppError(new Error('plain'))).toBe(false);
    expect(isAppError('string')).toBe(false);
    expect(isAppError(null)).toBe(false);
  });

  it('err() is a shortcut for new AppError', () => {
    const e = err('NOT_FOUND', 'gone');
    expect(e).toBeInstanceOf(AppError);
    expect(e.code).toBe('NOT_FOUND');
    expect(e.message).toBe('gone');
  });
});

describe('handleActionError', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('handles AppError with userMessage', () => {
    const e = new AppError('VALIDATION', 'bad input', { userMessage: 'Input inválido' });
    const result = handleActionError(e, 'testAction');
    expect(result).toEqual({
      success: false,
      error: 'Input inválido',
      code: 'VALIDATION',
    });
  });

  it('falls back to default userMessage for unknown errors', () => {
    const result = handleActionError(new Error('boom'), 'testAction');
    expect(result.code).toBe('UNKNOWN');
    expect(result.error).toBeTruthy();
  });

  it('handles legacy string throws ("UNAUTHENTICATED")', () => {
    const result = handleActionError('UNAUTHENTICATED', 'testAction');
    expect(result).toEqual({
      success: false,
      error: 'Tu sesión expiró. Inicia sesión de nuevo.',
      code: 'UNAUTHENTICATED',
    });
  });

  it('handles legacy CONFLICT_409 string', () => {
    const result = handleActionError('CONFLICT_409_stock', 'testAction');
    expect(result.code).toBe('CONFLICT');
  });

  it('handles non-Error throws', () => {
    const result = handleActionError(42, 'testAction');
    expect(result.success).toBe(false);
    expect(result.code).toBe('UNKNOWN');
  });

  it('recognizes "Unauthorized" in Error.message', () => {
    const result = handleActionError(new Error('Unauthorized access'), 'testAction');
    expect(result.code).toBe('UNAUTHENTICATED');
  });

  it('recognizes network errors in Error.message', () => {
    const result = handleActionError(new Error('Network timeout'), 'testAction');
    expect(result.code).toBe('NETWORK');
  });

  it('logs the error with context', () => {
    handleActionError(new Error('boom'), 'myContext');
    expect(consoleSpy).toHaveBeenCalledWith(
      '[myContext] boom',
      expect.any(String),
    );
  });
});

describe('warnSilently', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('logs Error.message with context', () => {
    warnSilently('fetchBranding', new Error('boom'));
    expect(consoleSpy).toHaveBeenCalledWith('[fetchBranding] boom');
  });

  it('handles non-Error values', () => {
    warnSilently('ctx', 'just a string');
    expect(consoleSpy).toHaveBeenCalledWith('[ctx] just a string');
  });

  it('handles null/undefined safely', () => {
    expect(() => warnSilently('ctx', null)).not.toThrow();
    expect(() => warnSilently('ctx', undefined)).not.toThrow();
  });
});

describe('withErrorLogging', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('returns the resolved value on success', async () => {
    const result = await withErrorLogging(async () => 42, 'test');
    expect(result).toBe(42);
  });

  it('returns undefined and logs on rejection', async () => {
    const result = await withErrorLogging(async () => {
      throw new Error('boom');
    }, 'test');
    expect(result).toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith('[test] boom');
  });
});

describe('isSuccess / isFailure (type guards)', () => {
  it('isSuccess narrows success branch', () => {
    const res: { success: true; data: string } | { success: false; error: string } = {
      success: true,
      data: 'hello',
    };
    if (isSuccess<{ data: string }>(res)) {
      // narrows to success branch
      expect(res.data).toBe('hello');
    } else {
      throw new Error('should be success');
    }
  });

  it('isFailure narrows failure branch', () => {
    const res: { success: true } | { success: false; error: string } = {
      success: false,
      error: 'fail',
    };
    if (isFailure(res)) {
      expect(res.error).toBe('fail');
    } else {
      throw new Error('should be failure');
    }
  });

  it('isFailure detects non-failure payloads as failure (when success=false)', () => {
    expect(isFailure({ success: false, error: 'x' })).toBe(true);
    expect(isFailure({ success: true })).toBe(false);
  });
});