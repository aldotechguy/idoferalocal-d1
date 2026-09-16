import React from 'react';
import { AuthProvider } from '../context/AuthContext';
import { AppProvider } from '../context/AppContext';
import { MallProvider } from '../context/MallContext';

export const StaffProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AuthProvider>
    <AppProvider>
      <MallProvider>{children}</MallProvider>
    </AppProvider>
  </AuthProvider>
);
