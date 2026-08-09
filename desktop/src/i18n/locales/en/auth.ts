import type { DeepPartial } from '../../types'
import type { auth as source } from '../ja/auth'

export const auth: DeepPartial<typeof source> = {
  brand: {
    title: 'Run the whole club from one screen.',
    description:
      'Bookings, caddies, courses, cancellation fees — the operations screen that connects the course floor and the office.',
  },
  loading: {
    label: 'Loading',
    redirecting: 'Taking you to sign in…',
    wait: 'Opening the secure sign-in page. One moment.',
    dismiss: 'Dismiss',
  },
  signIn: {
    kicker: 'Sign in',
    title: 'Welcome back',
    description: 'Sign in to Course Board with your Tachyon account.',
    username: 'Username or email',
    password: 'Password',
    submit: 'Sign in',
    google: 'Sign in with Google',
    legal: 'By continuing you agree to the terms of service and the privacy policy.',
    expired: {
      title: 'Your session expired',
      description: 'You were signed out for safety. Please sign in again.',
    },
  },
  session: {
    verifying: 'Checking your session…',
    expired: 'Your session expired. Please sign in again.',
  },
  tenant: {
    kicker: 'Course',
    title: 'Choose a course',
    description: 'Pick the course you will work on in this session.',
    production: 'Live',
    sandbox: 'Test',
    unknown: 'Unknown',
    otherAccount: 'Sign in with another account',
    select: 'Choose a course',
  },
  problem: {
    forbidden: {
      title: 'You do not have access to this course',
      description: 'Switch to a course you can access, or ask an administrator about your permissions.',
    },
    unknown: {
      title: 'Could not check your sign-in',
      description: 'Could not check your sign-in.',
    },
    initFailed: 'Could not prepare sign-in.',
    startFailed: 'Could not start sign-in.',
    signInFailed: 'Could not sign you in.',
    tenantUnverified: {
      title: 'Could not confirm the course',
      description: 'Your permissions for this course could not be confirmed. Wait a moment and try again.',
    },
  },
  error: {
    missingCredentials: 'Enter your username and password.',
    passwordChangeRequired:
      'You must change your first password. Change it in the Tachyon Account Center, then sign in again.',
    invalidCredentials: 'The username or password is wrong, or the account cannot be used.',
    userUnconfirmed: 'This account has not been confirmed yet.',
    passwordResetRequired: 'The password must be reset.',
    tooManyAttempts: 'Too many sign-in attempts. Wait a moment and try again.',
    rejected: 'Sign-in was refused.',
    serviceUnavailable: 'The sign-in service is temporarily unavailable. Try again shortly.',
    unreachable: 'Could not reach the sign-in service.',
    requestExpired: 'The sign-in request expired. Please sign in again.',
    responseMissing: 'No sign-in response was received. Please sign in again.',
    profileFailed: 'Could not load your account details.',
  },
}
