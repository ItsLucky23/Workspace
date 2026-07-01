import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import config, { providers, SessionLayout } from "config";
import tryCatch from "src/_functions/tryCatch";
import notify from "../_functions/notify";
const env = import.meta.env;

export default function LoginForm({ formType }: { formType: "login" | "register" }) {
  const isLogin = formType === "login";
  const title = isLogin ? "Sign in to your account" : "Create a new account";
  const subtitleText = isLogin ? "Don't have an account yet? " : "Already have an account? ";
  const subtitleLink = isLogin ? "Create one now" : "Log in";
  const redirectURL = isLogin ? "/register" : "/login";
  const buttonText = isLogin ? "Log in" : "Sign up";

  const buttonRef = useRef<HTMLButtonElement>(null);
  const [loading, setLoading] = useState(false);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      buttonRef.current?.click();
    }
  };

  const handleSubmit = async (e: React.MouseEvent<HTMLButtonElement>, provider: string) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);

    if (provider !== "credentials") {
      window.location.href = `${config.backendUrl}/auth/api/${provider}`;
      return;
    }

    const form = (e.target as HTMLElement).closest("form");
    if (!form) {
      setLoading(false);
      return console.error("Form not found");
    }

    const getValue = (name: string) =>
      (form.querySelector(`input[name="${name}"]`) as HTMLInputElement)?.value || "";

    const name = getValue("name");
    const email = getValue("email");
    const password = getValue("password");
    const confirmPassword = getValue("confirmPassword");

    const fetchUser = async () => {
      const res = await fetch(`${config.backendUrl}/auth/api/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, confirmPassword, provider }),
        credentials: "include",
      });
      return (await res.json()) as { status: boolean; reason: string, newToken: string | null, session: SessionLayout | undefined };
    };

    const [error, response] = await tryCatch(fetchUser);
    if (error || !response?.reason) {
      // notify.error("Unexpected error occurred.");
      notify.error({ key: 'commen/.404' })
      console.error(error || "No JSON response");
      return setLoading(false);
    }

    if (!response.status) {
      notify.error({ key: response.reason });
      return setLoading(false);
    }

    notify.success({ key: response.reason });
    setTimeout(() => {
      if (response.newToken) {
        if (env.VITE_SESSION_BASED_TOKEN == 'true') {
          sessionStorage.setItem("token", response.newToken);
        }
      }
      window.location.href = response.newToken ? config.loginRedirectUrl : config.loginPageUrl;
      // window.location.href = config.loginPageUrl;
    }, 1000);
  };

  return (
    <div className="w-full overflow-y-auto flex items-center justify-center">
      <form
        onKeyDown={handleKeyDown}
        className="p-8 bg-container rounded-md text-title flex flex-col gap-10 max-w-[400px] w-full"
      >
        <div className="flex flex-col gap-2">
          <h1 className="font-semibold text-lg">{title}</h1>
          <p className="font-medium text-sm text-common">
            {subtitleText}
            <Link to={redirectURL} className="text-blue-500 cursor-pointer">
              {subtitleLink}
            </Link>
          </p>
        </div>

        {providers.includes("credentials") && (
          <>
            <div className="flex flex-col gap-4">
              {!isLogin && (
                <div className="flex flex-col gap-2">
                  <label className="font-medium text-sm">Name</label>
                  <input
                    name="name"
                    type="text"
                    placeholder="John Pork"
                    className="rounded-md w-full h-8 border border-container-border focus:outline-blue-500 p-2"
                  />
                </div>
              )}
              <div className="flex flex-col gap-2">
                <label className="font-medium text-sm">Email address</label>
                <input
                  name="email"
                  type="email"
                  placeholder="johnpork@gmail.com"
                  className="rounded-md w-full h-8 border border-container-border focus:outline-blue-500 p-2"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="font-medium text-sm">Password</label>
                <input
                  name="password"
                  type="password"
                  placeholder="********"
                  className="rounded-md w-full h-8 border border-container-border focus:outline-blue-500 p-2"
                />
              </div>
              {!isLogin && (
                <div className="flex flex-col gap-2">
                  <label className="font-medium text-sm">Confirm password</label>
                  <input
                    name="confirmPassword"
                    type="password"
                    placeholder="********"
                    className="rounded-md w-full h-8 border border-container-border focus:outline-blue-500 p-2"
                  />
                </div>
              )}

              <div className="flex items-center justify-center">
                {isLogin && (
                  <button className="px-8 h-10 cursor-pointer rounded-md text-blue-500 hover:scale-105 transition-all duration-300">
                    Forgot Password?
                  </button>
                )}
              </div>

              <button
                ref={buttonRef}
                className="px-8 h-10 rounded-md bg-blue-500 text-title hover:scale-105 transition-all duration-300 cursor-pointer"
                onClick={(e) => void handleSubmit(e, "credentials")}
              >
                {loading ? "Loading..." : buttonText}
              </button>
            </div>

            <div className="flex items-center w-full text-gray-500 text-sm before:flex-1 before:border-t before:border-container-border before:content-[''] after:flex-1 after:border-t after:border-container-border after:content-['']">
              <span className="px-4 bg-container text-title">Or continue with</span>
            </div>
          </>
        )}

        <div className="grid grid-cols-2 gap-2">
          {providers
            .filter((p) => p !== "credentials")
            .map((provider) => (
              <button
                key={provider}
                onClick={(e) => void handleSubmit(e, provider)}
                className="h-10 rounded-md cursor-pointer bg-container text-title border border-container-border flex gap-2 items-center justify-center hover:scale-105 transition-all duration-300"
              >
                <img src={`/${provider}.png`} alt={provider} className="w-5 h-5" />
                <span className="text-lg">{provider.charAt(0).toUpperCase() + provider.slice(1)}</span>
              </button>
            ))}
        </div>
      </form>
    </div>
  );
}
