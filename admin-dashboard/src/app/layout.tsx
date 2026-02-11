import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { MainLayout } from "@/components/layout/main-layout";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
    title: "Salon Admin Dashboard",
    description: "サロン予約管理システム",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="ja">
            <body className={inter.className}>
                <AuthProvider>
                    <MainLayout>{children}</MainLayout>
                </AuthProvider>
            </body>
        </html>
    );
}
