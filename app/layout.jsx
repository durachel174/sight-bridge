import "./globals.css";

export const metadata = {
  title: "SightBridge",
  description: "Disclosure awareness for camera-based AI assistance."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
