import { createSignal } from "solid-js";
import ChatArea from "./components/ChatArea";
import Sidebar from "./components/Sidebar";
import SettingsDialog from "./components/SettingsDialog";

export default function App() {
  const [settingsOpen, setSettingsOpen] = createSignal(false);

  return (
    <div class="flex h-screen w-screen overflow-hidden font-sans antialiased">
      <Sidebar onOpenSettings={() => setSettingsOpen(true)} />
      <main class="flex flex-1 flex-col">
        <ChatArea />
      </main>
      <SettingsDialog
        open={settingsOpen()}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
