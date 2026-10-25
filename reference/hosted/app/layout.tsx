import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Entity Asset Library",
  description: "原始 Entity 资产核对与浏览器实时预览。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
