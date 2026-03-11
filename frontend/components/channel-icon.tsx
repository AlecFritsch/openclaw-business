// Channel brand logos via react-icons/si + fallback SVGs for missing brands
import { SiWhatsapp, SiTelegram, SiDiscord, SiSlack, SiSignal, SiLine, SiGooglechat, SiMattermost, SiImessage } from "react-icons/si";
import { Mail, MessageCircle } from "lucide-react";

interface ChannelIconProps {
  channel: string;
  size?: number;
  className?: string;
}

const CHANNEL_MAP: Record<string, { icon: React.ComponentType<{ size?: number; className?: string }>; color: string }> = {
  whatsapp:    { icon: SiWhatsapp,    color: "#25D366" },
  telegram:    { icon: SiTelegram,    color: "#26A5E4" },
  discord:     { icon: SiDiscord,     color: "#5865F2" },
  slack:       { icon: SiSlack,       color: "#4A154B" },
  signal:      { icon: SiSignal,      color: "#3B45FD" },
  imessage:    { icon: SiImessage,    color: "#34DA50" },
  bluebubbles: { icon: SiImessage,    color: "#34DA50" },
  line:        { icon: SiLine,        color: "#00C300" },
  googlechat:  { icon: SiGooglechat,  color: "#34A853" },
  mattermost:  { icon: SiMattermost,  color: "#0058CC" },
};

export function ChannelIcon({ channel, size = 24, className = "" }: ChannelIconProps) {
  const key = channel.toLowerCase();
  const mapped = CHANNEL_MAP[key];

  if (mapped) {
    const Icon = mapped.icon;
    return <Icon size={size} className={className} />;
  }

  // Channels without react-icons equivalents
  switch (key) {
    case "msteams":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="#5059C9" className={className}>
          <circle cx="20.288" cy="8.344" r="1.707" />
          <path d="M18.581 11.513h3.413v3.656c0 .942-.765 1.706-1.707 1.706h-1.706v-5.362zM2.006 4.2v15.6l11.213 1.979V2.221L2.006 4.2zm8.288 5.411-1.95.049v5.752H6.881V9.757l-1.949.098V8.539l5.362-.292v1.364zm3.899.439v8.288h1.95c.808 0 1.463-.655 1.463-1.462V10.05h-3.413zm1.463-4.875c-.586 0-1.105.264-1.463.673v2.555c.357.409.877.673 1.463.673a1.95 1.95 0 0 0 0-3.901z" />
        </svg>
      );
    case "matrix":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="#0DBD8B" className={className}>
          <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm-1.314 4.715c3.289 0 5.956 2.66 5.956 5.943 0 .484-.394.877-.879.877s-.879-.393-.879-.877c0-2.313-1.88-4.189-4.198-4.189-.486 0-.879-.393-.879-.877s.392-.877.879-.877zm-5.092 9.504c-.486 0-.879-.394-.879-.877 0-3.283 2.666-5.945 5.956-5.945.485 0 .879.393.879.877s-.394.876-.879.876c-2.319 0-4.198 1.877-4.198 4.191 0 .484-.395.878-.879.878zm7.735 5.067c-3.29 0-5.957-2.662-5.957-5.944 0-.484.394-.878.879-.878s.879.394.879.878c0 2.313 1.88 4.189 4.199 4.189.485 0 .879.393.879.877 0 .486-.394.878-.879.878zm0-2.683c-.485 0-.88-.393-.88-.876 0-.484.395-.878.88-.878 2.318 0 4.199-1.876 4.199-4.19 0-.484.393-.877.879-.877.485 0 .879.393.879.877 0 3.282-2.667 5.944-5.957 5.944z" />
        </svg>
      );
    case "feishu":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="#3370FF" className={className}>
          <path d="M3.794 6.09c2.878-1.327 6.02-1.49 8.523-.666L4.55 12.19a.382.382 0 0 0 .179.645l11.726 3.143c-1.479 3.316-5.088 5.63-9.17 5.476C2.887 21.278-.258 17.57.015 13.039c.14-2.33 1.428-4.978 3.779-6.948zm9.303-.39c1.84.945 3.354 2.394 4.327 4.254l-4.686 4.83-7.948-2.13z" />
        </svg>
      );
    case "superchat":
      return <MessageCircle size={size} className={className} style={{ color: "#6366F1" }} />;
    case "webchat":
      return <MessageCircle size={size} className={className} />;
    case "email":
      return <Mail size={size} className={className} />;
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect x="2" y="2" width="20" height="20" rx="4" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
          <text x="12" y="16" textAnchor="middle" fontSize="10" fontFamily="monospace" fill="currentColor" opacity="0.5">
            {channel.slice(0, 2).toUpperCase()}
          </text>
        </svg>
      );
  }
}
