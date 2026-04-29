import { createSignal } from "solid-js";
import ChatArea from "./components/ChatArea";
import FilesDrawer from "./components/FilesDrawer";
import Sidebar from "./components/Sidebar";
import SettingsDialog from "./components/SettingsDialog";

export default function App() {
  const [settingsOpen, setSettingsOpen] = createSignal(false);

  return (
    <div class="flex h-screen w-screen overflow-hidden font-sans antialiased">
      <Sidebar onOpenSettings={() => setSettingsOpen(true)} />
      <main class="flex flex-1 overflow-hidden">
        <ChatArea />
        <FilesDrawer />
      </main>
      <SettingsDialog
        open={settingsOpen()}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
