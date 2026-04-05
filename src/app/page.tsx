import PeerContainer from "@/components/PeerContainer";
import Dashboard from "@/components/Dashboard";
import VideoInterface from "@/components/VideoInterface";
import ChatInterface from "@/components/ChatInterface";
import ActiveCallWrapper from "@/components/ActiveCallWrapper";

export default function Home() {
  return (
    <PeerContainer>
      <main className="relative w-full min-h-screen">
        {/* Dashboard is always rendered underneath */}
        <Dashboard />

        {/* When a media session is active, overlay the full-screen video */}
        <ActiveCallWrapper>
          <VideoInterface />
        </ActiveCallWrapper>

        {/* Chat sidebar & toggle — always mounted so messages persist */}
        <ChatInterface />
      </main>
    </PeerContainer>
  );
}
