import { useLocation, useNavigate } from "react-router-dom";
import middlewareHandler from "src/_functions/middlewareHandler";
import { useSession } from "../_providers/SessionProvider";

const getParams = (locationSearch: string) => {
  const params = new URLSearchParams(locationSearch);
  const queryObject: Record<string, string> = {};

  params.forEach((value, key) => {
    queryObject[key] = value;
  });

  return queryObject;
}

export default function useRouter() {
  const navigateHandler = useNavigate();
  const location = useLocation();
  const { session } = useSession();

  return async (path: string) => {
    // const session = await apiRequest({ name: 'session' }) as SessionLayout;
    const queryObject = getParams(location.search);
    const result = await middlewareHandler({ location: path, searchParams: queryObject, session }) as { success: boolean, redirect: string } | undefined;

    if (result?.success) {
      return navigateHandler(path);
    } else if (result?.redirect) {
      return navigateHandler(result.redirect);
    } else {
      return
    }
  }
}