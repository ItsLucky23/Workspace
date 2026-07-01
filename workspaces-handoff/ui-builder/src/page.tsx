import config from "config";
import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useSession } from "./_providers/SessionProvider";
const env = import.meta.env;

export const template = 'plain'
export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, sessionLoaded } = useSession();

  useEffect(() => {
 
    const params = new URLSearchParams(location.search);
    const token = params.get('token');
    if (token && env.VITE_SESSION_BASED_TOKEN == 'true') {
      sessionStorage.setItem('token', token);
      window.location.href = window.location.pathname;
      return;
    }

    if (sessionLoaded) {
      if (session?.id) {
        navigate(config.loginRedirectUrl);
      } else {
        navigate(config.loginPageUrl);
      }
    }

  }, [navigate, location, session, sessionLoaded]);

  useEffect(() => {
    let timeout = setTimeout(() => {
      if (!sessionLoaded) {
        navigate(config.loginPageUrl)
      }
    }, 1000);
    return () => {
      clearTimeout(timeout)
    }
  }, [sessionLoaded])


  return null;
}