import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { BookOpen, LogIn, UserPlus } from "lucide-react";
import { login, register } from "@/sync/engine";
import { useNotesStore } from "@/store/notes";

type Mode = "login" | "register";

export default function LoginPage() {
  const navigate = useNavigate();
  const setUser = useNotesStore((s) => s.setUser);
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = mode === "login" 
        ? await login(email, password)
        : await register(email, password);
      setUser(result.user);
      navigate("/");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleOfflineMode = () => {
    navigate("/");
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-gradient-to-br from-moss-50 via-ink-50 to-amber-50/30" />
      <div className="relative w-full max-w-md animate-fadeIn">
        <div className="card p-8">
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-moss-500 text-white flex items-center justify-center shadow-soft mx-auto mb-4">
              <BookOpen size={28} />
            </div>
            <h1 className="font-display text-3xl font-bold text-ink-700">
              {mode === "login" ? "Welcome back" : "Create account"}
            </h1>
            <p className="text-sm text-ink-500 mt-2">
              {mode === "login" 
                ? "Sign in to sync your notes across devices" 
                : "Start your offline-first note journey"}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 rounded-xl bg-red-50 text-red-600 text-sm border border-red-100">
                {error}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-ink-600 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-2.5 rounded-xl border border-ink-200 bg-white text-ink-700 placeholder:text-ink-300 focus:border-moss-500 focus:shadow-soft transition"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-600 mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 rounded-xl border border-ink-200 bg-white text-ink-700 placeholder:text-ink-300 focus:border-moss-500 focus:shadow-soft transition"
                required
                minLength={6}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary w-full py-2.5"
            >
              {loading ? (
                <span className="animate-pulse">...</span>
              ) : mode === "login" ? (
                <> <LogIn size={16} /> Sign in </>
              ) : (
                <> <UserPlus size={16} /> Create account </>
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => setMode(mode === "login" ? "register" : "login")}
              className="text-sm text-moss-600 hover:text-moss-700 underline underline-offset-2"
            >
              {mode === "login" 
                ? "Don't have an account? Sign up" 
                : "Already have an account? Sign in"}
            </button>
          </div>

          <div className="mt-8 pt-6 border-t border-ink-100">
            <div className="text-center">
              <Link
                to="/"
                onClick={handleOfflineMode}
                className="text-sm text-ink-500 hover:text-ink-700 flex items-center justify-center gap-2"
              >
                Continue in offline mode →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
