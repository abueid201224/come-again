import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, loginWithGoogle, logoutUser, testFirestoreConnection } from '../services/firebase';

interface AuthContextType {
  currentUser: User | null;
  isLoading: boolean;
  isCloudConnected: boolean;
  login: () => Promise<User | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  currentUser: null,
  isLoading: true,
  isCloudConnected: false,
  login: async () => null,
  logout: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCloudConnected, setIsCloudConnected] = useState(false);

  useEffect(() => {
    // Check initial connection
    testFirestoreConnection().then(connected => {
      setIsCloudConnected(connected);
    });

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try {
      const user = await loginWithGoogle();
      return user;
    } catch (err) {
      console.error('Login failed', err);
      throw err;
    }
  };

  const handleLogout = async () => {
    try {
      await logoutUser();
    } catch (err) {
      console.error('Logout failed', err);
      throw err;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isLoading,
        isCloudConnected,
        login: handleLogin,
        logout: handleLogout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
