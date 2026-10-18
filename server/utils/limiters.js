import rateLimit from 'express-rate-limit';
const skip = () => process.env.NODE_ENV === 'test';
const make = (windowMs, limit, message) => rateLimit({ windowMs, limit, skip, standardHeaders: true, legacyHeaders: false, message: { success: false, message } });
export const apiLimiter = make(15 * 60 * 1000, 600, 'Too many requests. Please slow down');
export const loginLimiter = make(15 * 60 * 1000, 10, 'Too many login attempts. Try again in 15 minutes');
export const registerLimiter = make(60 * 60 * 1000, 20, 'Too many sign-ups from this address. Try again later');
export const resetLimiter = make(15 * 60 * 1000, 5, 'Too many reset attempts. Try again later');
