import { z } from 'zod';

export const signupSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, 'Name is required')
        .min(2, 'Name must be at least 2 characters')
        .max(60, 'Name too long'),

    email: z
        .email('Invalid email address'),

    phone: z
        .string()
        .trim()
        .min(7, 'Invalid phone number')
        .max(20, 'Invalid phone number')
        .optional()
        .or(z.literal('')),

    password: z
        .string()
        .min(1, 'Password is required')
        .min(8, 'Password must be at least 8 characters')
        .max(128, 'Password too long'),

    confirmPassword: z
        .string()
        .min(1, 'Please confirm your password'),
})
    .refine((d) => d.password === d.confirmPassword, {
        message: 'Passwords do not match',
        path: ['confirmPassword'],
    })
    .refine((d) => d.email || d.phone, {
        message: 'At least one of email or phone number is required',
        path: ['email'],
    });

export type SignupInput = z.infer<typeof signupSchema>;
