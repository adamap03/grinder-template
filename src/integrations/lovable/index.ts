// Google sign-in went through Lovable Cloud and Supabase; accounts now live in Notion (email + password only).
export const lovable = {
  auth: {
    signInWithOAuth: async (_provider: string, _opts?: unknown) => ({ error: new Error('Google sign-in is not available. Use email and password.'), redirected: false }),
  },
};
