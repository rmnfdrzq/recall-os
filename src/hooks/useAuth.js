import { useEffect, useState } from "react";

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(
    !!localStorage.getItem("user_token"),
  );

  useEffect(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    setTimeout(() => window.dispatchEvent(new Event("resize")), 100);
  }, []);

  const signIn = (username, password) => {
    if (username === "admin" && password === "admin") {
      localStorage.setItem("user_token", "mock-jwt-admin-token");
      setIsAuthenticated(true);
      return true;
    }
    return false;
  };

  const signOut = () => {
    localStorage.removeItem("user_token");
    setIsAuthenticated(false);
  };

  return { isAuthenticated, signIn, signOut };
}
