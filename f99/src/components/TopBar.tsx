import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { BookOpen, LogIn, UserPlus, LogOut, Settings as SettingsIcon } from "lucide-react";
import SyncIndicator from "./SyncIndicator";
import { useNotesStore } from "@/store/notes";
import { logout } from "@/sync/engine";

export default function TopBar() {
  const user = useNotesStore((s) => s.user);
  const setUser = useNotesStore((s) => s.setUser);
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);

  const handleLogout = () => {
    logout();
    setUser(null);
    navigate("/");
    setMenu(false);
  };

  return (
    <header className="flex items-center justify-between px-5 py-3 bg-white/80 backdrop-blur border-b border-ink-100">
      <Link to="/" className="flex items-center gap-2 group">
        <div className="w-9 h-9 rounded-xl bg-moss-500 text-white flex items-center justify-center shadow-soft group-hover:bg-moss-600 transition">
          <BookOpen size={18} />
        </div>
        <div>
          <div className="font-display font-bold text-lg text-ink-700 leading-none">Folio</div>
          <div className="text-[10px] text-ink-500 font-mono tracking-wide">Offline-first · SQLite Wasm</div>
        </div>
      </Link>
      <div className="flex items-center gap-3">
        <SyncIndicator />
        <Link to="/settings" className="btn-ghost" title="Settings">
          <SettingsIcon size={16} />
        </Link>
        {user ? (
          <div className="relative">
            <button
              onClick={() => setMenu((v) => !v)}
              className="btn btn-secondary !py-1.5 !px-3 text-xs"
            >
              <UserPlus size={12} /> {user.email.split("@")[0]}
            </button>
            {menu && (
              <div className="absolute right-0 mt-2 w-44 bg-white rounded-xl shadow-ring border border-ink-100 py-2 z-50 animate-fadeIn">
                <div className="px-4 py-1 text-xs text-ink-500 truncate">{user.email}</div>
                <button onClick={handleLogout} className="w-full text-left px-4 py-2 text-sm hover:bg-ink-50 flex items-center gap-2">
                  <LogOut size={14} /> Logout
                </button>
              </div>
            )}
          </div>
        ) : (
          <Link to="/login" className="btn btn-primary !py-1.5 !px-3 text-xs">
            <LogIn size={12} /> Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
