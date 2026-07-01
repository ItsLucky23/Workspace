import { ReactNode, useEffect, useState } from "react";
import middlewareHandler from "src/_functions/middlewareHandler"
import { useLocation, useNavigate } from "react-router-dom";
import { useSession } from "../_providers/SessionProvider";

export default function Middleware({ children }: { children: ReactNode }) {
  const [allowed, setAllowed] = useState(false);
  const [checking, setChecking] = useState(true);

  const location = useLocation();
  const navigate = useNavigate();
  const { session, sessionLoaded } = useSession();

  useEffect(() => {
    let isMounted = true;
    setAllowed(false);
    setChecking(true);

    void (async () => {
      const params = new URLSearchParams(location.search);
      const queryObject: Record<string, string> = {};

      params.forEach((value, key) => {
        queryObject[key] = value;
      });

      let count = 0;
      while (!sessionLoaded) { 
        await new Promise(res => setTimeout(res, 10));
        count++;
        if (count > 500) break; // after 5 seconds we stop waiting for the session
      }

      // const session = await apiRequest({ name: 'session' }) as SessionLayout;
      const result = await middlewareHandler({ location: location.pathname, searchParams: queryObject, session }) as { success: boolean, redirect: string } | undefined;

      if (!isMounted) return;
      if (result?.success) {
        setAllowed(true);
      } else if (result?.redirect) {
        void navigate(result.redirect);
      } else {
        void navigate(-1);
      }

      setChecking(false);

      return () => {
        isMounted = false;
      }

    })();

    //! dont remove isMounted, read below
    //? i dont know why but the isMounted = false will always be false but because of this the navigate(-1) will always redirect to the previous page
    //? if we remove the isMounted variable than it will redirect to the previous page and then to the page before that one and so on wich we dont want
    //? e.g if we are on /test and go to /admin wich is not allowed we come back to /test, if we spam this request we come back to /test but if we remove the isMounted
    //? we first go back to /test but the second time we go back to the route before /test e.g /dashboard wich we dont want
    return () => {
      isMounted = false;
    };
  }, [location.pathname, sessionLoaded]); // important: rerun on path change

  if (checking || !allowed) return null;
  return <div className="w-full h-full">{children}</div>;
}