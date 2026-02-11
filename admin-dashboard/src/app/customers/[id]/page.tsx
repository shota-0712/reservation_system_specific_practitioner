"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Calendar, Clock, Edit, Image as ImageIcon, Mail, Phone, Tag, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { customersApi } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Customer {
    id: string;
    name: string;
    nameKana?: string;
    phone?: string;
    email?: string;
    tags?: string[];
    rfmSegment?: string;
    totalVisits?: number;
    totalSpend?: number;
}

interface Reservation {
    id: string;
    date: string;
    startTime: string;
    endTime: string;
    menuNames?: string[];
    practitionerName?: string;
    status: string;
}

export default function CustomerDetailPage() {
    const router = useRouter();
    const params = useParams();
    const id = params.id as string;

    const [customer, setCustomer] = useState<Customer | null>(null);
    const [history, setHistory] = useState<Reservation[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const [customerRes, reservationsRes] = await Promise.all([
                    customersApi.get(id),
                    customersApi.getReservations(id),
                ]);

                if (customerRes.success && customerRes.data) {
                    const data = customerRes.data as any;
                    setCustomer({
                        id: data.id,
                        name: data.name,
                        nameKana: data.nameKana,
                        phone: data.phone,
                        email: data.email,
                        tags: data.tags || [],
                        rfmSegment: data.rfmSegment,
                        totalVisits: data.totalVisits,
                        totalSpend: data.totalSpend,
                    });
                }
                if (reservationsRes.success && Array.isArray(reservationsRes.data)) {
                    setHistory(reservationsRes.data as Reservation[]);
                }
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [id]);

    if (loading) {
        return <div className="p-8 text-sm text-muted-foreground">読み込み中...</div>;
    }

    if (!customer) {
        return <div className="p-8">Customer not found</div>;
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => router.back()}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">{customer.name} 様</h1>
                    <p className="text-muted-foreground flex items-center gap-2">
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">ID: {customer.id}</span>
                        {customer.nameKana}
                    </p>
                </div>
                <div className="ml-auto flex gap-2">
                    <Button variant="outline">
                        <Edit className="mr-2 h-4 w-4" />
                        編集
                    </Button>
                    <Button variant="default">
                        <Calendar className="mr-2 h-4 w-4" />
                        予約作成
                    </Button>
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-12">
                {/* Left Column: Basic Info */}
                <div className="md:col-span-4 space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">基本情報</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-500">
                                    <User className="h-5 w-5" />
                                </div>
                                <div>
                                    <div className="font-medium">{customer.rfmSegment || "-"}</div>
                                    <div className="text-xs text-muted-foreground">ランク</div>
                                </div>
                            </div>

                            <div className="space-y-3 pt-2 border-t text-sm">
                                {customer.phone && (
                                    <div className="flex items-center gap-2 text-gray-600">
                                        <Phone className="h-4 w-4" />
                                        <span>{customer.phone}</span>
                                    </div>
                                )}
                                {customer.email && (
                                    <div className="flex items-center gap-2 text-gray-600">
                                        <Mail className="h-4 w-4" />
                                        <span>{customer.email}</span>
                                    </div>
                                )}
                            </div>

                            <div className="pt-2 border-t">
                                <div className="text-sm text-gray-600 mb-2">タグ</div>
                                <div className="flex flex-wrap gap-1">
                                    {(customer.tags || []).map(tag => (
                                        <span key={tag} className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-xs">
                                            <Tag className="h-3 w-3" />
                                            {tag}
                                        </span>
                                    ))}
                                    {(!customer.tags || customer.tags.length === 0) && (
                                        <span className="text-xs text-muted-foreground">なし</span>
                                    )}
                                </div>
                            </div>

                            <div className="pt-2 border-t grid grid-cols-2 gap-4 text-center">
                                <div>
                                    <div className="text-2xl font-bold">{customer.totalVisits ?? 0}</div>
                                    <div className="text-xs text-muted-foreground">来店回数</div>
                                </div>
                                <div>
                                    <div className="text-xl font-bold">¥{(customer.totalSpend ?? 0).toLocaleString()}</div>
                                    <div className="text-xs text-muted-foreground">累計売上</div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">メモ</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <textarea
                                className="w-full min-h-[100px] p-3 text-sm border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                                placeholder="顧客に関するメモを入力..."
                            />
                        </CardContent>
                    </Card>
                </div>

                {/* Right Column: Main Content */}
                <div className="md:col-span-8">
                    <Tabs defaultValue="medical" className="w-full">
                        <TabsList className="grid w-full grid-cols-3">
                            <TabsTrigger value="medical">カルテ (Medical)</TabsTrigger>
                            <TabsTrigger value="answers">アンケート (Answers)</TabsTrigger>
                            <TabsTrigger value="history">履歴 (History)</TabsTrigger>
                        </TabsList>

                        {/* Medical Record Tab */}
                        <TabsContent value="medical" className="space-y-4 mt-4">
                            <Card>
                                <CardContent className="p-4">
                                    <div className="flex gap-2 mb-4">
                                        <textarea
                                            className="flex-1 min-h-[80px] p-3 text-sm border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                                            placeholder="本日の施術記録を入力..."
                                        />
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <Button variant="outline" size="sm">
                                            <ImageIcon className="mr-2 h-4 w-4" />
                                            画像追加
                                        </Button>
                                        <Button size="sm">記録を保存</Button>
                                    </div>
                                </CardContent>
                            </Card>

                            <div className="text-center py-8 text-gray-400 text-sm">カルテ記録はありません</div>
                        </TabsContent>

                        {/* Answers Tab */}
                        <TabsContent value="answers" className="mt-4">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg">カウンセリングシート回答</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="text-center py-8 text-gray-400 text-sm">回答データはありません</div>
                                </CardContent>
                            </Card>
                        </TabsContent>

                        {/* History Tab */}
                        <TabsContent value="history" className="mt-4">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg">来店・予約履歴</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-4">
                                        {history.map((h) => (
                                            <div key={h.id} className="flex items-start gap-4 p-3 border rounded-lg hover:bg-gray-50 transition-colors">
                                                <div className="bg-gray-100 p-2 rounded text-center min-w-[60px]">
                                                    <div className="text-xs text-gray-500">{h.date.split('-')[0]}</div>
                                                    <div className="font-bold text-gray-800">{h.date.split('-')[1]}/{h.date.split('-')[2]}</div>
                                                </div>
                                                <div>
                                                    <div className="font-bold text-sm">{h.menuNames?.[0] || 'メニュー未定'}</div>
                                                    <div className="text-xs text-gray-500 mt-1">
                                                        <Clock className="inline-block h-3 w-3 mr-1" />
                                                        {h.startTime} - {h.endTime}
                                                    </div>
                                                    <div className="text-xs text-gray-500 mt-1">担当: {h.practitionerName || '-'}</div>
                                                </div>
                                                <div className="ml-auto">
                                                    <span className={cn(
                                                        "px-2 py-1 rounded text-xs font-medium",
                                                        h.status === 'confirmed' ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                                                    )}>
                                                        {h.status}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                        {history.length === 0 && (
                                            <div className="text-center py-8 text-gray-400 text-sm">履歴がありません</div>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </Tabs>
                </div>
            </div>
        </div>
    );
}
