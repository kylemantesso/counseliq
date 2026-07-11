export interface User {
  userId: string;
  name: string;
  email: string;
  isAdmin: boolean;
}

export interface AuthContextType {
  user: User | null;
  loading: boolean;
  needsOnboarding: boolean;
  establishSession: (user: User) => void;
  logout: () => Promise<void>;
}

export interface AuthProviderOptions {
  onLogin?: () => void;
  onLogout?: () => void;
}
