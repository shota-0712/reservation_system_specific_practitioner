import Link from 'next/link';

export default function PrivacyPolicy() {
  const adminBaseUrl = (process.env.NEXT_PUBLIC_ADMIN_URL || '').replace(/\/+$/, '');
  const registerUrl = adminBaseUrl ? `${adminBaseUrl}/register` : '/register';

  return (
    <div className="min-h-screen bg-[#f6f5f4]">
      {/* Header */}
      <header className="fixed top-5 left-1/2 -translate-x-1/2 z-50 w-[95%] max-w-5xl">
        <div className="bg-white/90 backdrop-blur-md rounded-2xl shadow-sm border border-[#e8e4e2] px-6 py-3 flex justify-between items-center">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-[#ff2f2f] via-[#ef7b16] to-[#8a43e1] rounded-xl flex items-center justify-center">
              <span className="text-white font-bold text-sm">R</span>
            </div>
            <span className="font-bold text-lg text-[#1e1e1e]">Reserve</span>
          </Link>
          <div className="flex items-center gap-3">
            <a
              href={registerUrl}
              className="px-5 py-2.5 text-sm text-white font-semibold rounded-full bg-gradient-to-r from-[#ff2f2f] via-[#ef7b16] via-[#8a43e1] to-[#d511fd] hover:opacity-90 transition-opacity"
            >
              無料で始める
            </a>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="pt-32 pb-20 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="bg-white rounded-[24px] p-8 md:p-12 shadow-[0_1px_1px_#0000001a,0_8px_32px_#0000000d]">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-[#f6f5f4] border border-[#ded8d3] rounded-full text-sm font-medium text-[#1e1e1e] mb-6">
              プライバシーポリシー
            </div>

            <h1 className="text-2xl md:text-3xl font-bold text-[#1e1e1e] mb-4 tracking-tight">
              プライバシーポリシー
            </h1>

            <p className="text-sm text-[#888] mb-8">
              最終更新日: 2024年1月1日
            </p>

            <div className="prose prose-sm max-w-none">
              <section className="mb-8">
                <h2 className="text-lg font-bold text-[#1e1e1e] mb-3">1. はじめに</h2>
                <p className="text-[#666] leading-relaxed">
                  Reserve（以下「当社」）は、お客様のプライバシーを尊重し、個人情報の保護に努めています。
                  本プライバシーポリシーは、当社が提供する予約システムサービス（以下「本サービス」）における
                  個人情報の取り扱いについて説明するものです。
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-lg font-bold text-[#1e1e1e] mb-3">2. 収集する情報</h2>
                <p className="text-[#666] mb-3">当社は、以下の情報を収集することがあります：</p>
                <ul className="list-disc list-inside text-[#666] space-y-2 ml-2">
                  <li>氏名、メールアドレス、電話番号などの連絡先情報</li>
                  <li>LINEユーザーID、プロフィール情報</li>
                  <li>予約履歴、来店履歴</li>
                  <li>お支払い情報（クレジットカード情報は決済代行会社が管理）</li>
                  <li>IPアドレス、ブラウザ情報、デバイス情報</li>
                  <li>サービス利用状況に関するログ情報</li>
                </ul>
              </section>

              <section className="mb-8">
                <h2 className="text-lg font-bold text-[#1e1e1e] mb-3">3. 情報の利用目的</h2>
                <p className="text-[#666] mb-3">収集した情報は、以下の目的で利用します：</p>
                <ul className="list-disc list-inside text-[#666] space-y-2 ml-2">
                  <li>予約サービスの提供および管理</li>
                  <li>予約確認、リマインダー通知の送信</li>
                  <li>お問い合わせへの対応</li>
                  <li>サービスの改善および新機能の開発</li>
                  <li>利用状況の分析および統計データの作成</li>
                  <li>不正利用の防止およびセキュリティの確保</li>
                </ul>
              </section>

              <section className="mb-8">
                <h2 className="text-lg font-bold text-[#1e1e1e] mb-3">4. 情報の共有</h2>
                <p className="text-[#666] mb-3">
                  当社は、以下の場合を除き、お客様の個人情報を第三者に提供することはありません：
                </p>
                <ul className="list-disc list-inside text-[#666] space-y-2 ml-2">
                  <li>お客様の同意がある場合</li>
                  <li>予約先のサロン・店舗への情報提供（予約に必要な範囲）</li>
                  <li>法令に基づく開示要求がある場合</li>
                  <li>当社の権利、財産、安全を保護するために必要な場合</li>
                  <li>サービス提供に必要な業務委託先への提供（機密保持契約を締結）</li>
                </ul>
              </section>

              <section className="mb-8">
                <h2 className="text-lg font-bold text-[#1e1e1e] mb-3">5. データの保管とセキュリティ</h2>
                <p className="text-[#666] mb-3">
                  当社は、お客様の個人情報を適切に管理し、不正アクセス、紛失、破壊、改ざん、漏洩などを
                  防止するため、以下のセキュリティ対策を実施しています：
                </p>
                <ul className="list-disc list-inside text-[#666] space-y-2 ml-2">
                  <li>SSL/TLS暗号化通信の使用</li>
                  <li>データの暗号化保存</li>
                  <li>アクセス制御およびログ監視</li>
                  <li>定期的なセキュリティ監査</li>
                  <li>従業員への情報セキュリティ教育</li>
                </ul>
              </section>

              <section className="mb-8">
                <h2 className="text-lg font-bold text-[#1e1e1e] mb-3">6. お客様の権利</h2>
                <p className="text-[#666] mb-3">お客様は、以下の権利を有しています：</p>
                <ul className="list-disc list-inside text-[#666] space-y-2 ml-2">
                  <li>個人情報の開示請求</li>
                  <li>個人情報の訂正・削除請求</li>
                  <li>個人情報の利用停止請求</li>
                  <li>マーケティング目的の通知の停止</li>
                </ul>
                <p className="text-[#666] mt-3">
                  これらの権利を行使する場合は、下記のお問い合わせ先までご連絡ください。
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-lg font-bold text-[#1e1e1e] mb-3">7. Cookieの使用</h2>
                <p className="text-[#666] leading-relaxed">
                  当社は、サービスの利便性向上およびアクセス解析のためにCookieを使用しています。
                  お客様はブラウザの設定によりCookieを無効化することができますが、一部の機能が
                  利用できなくなる場合があります。
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-lg font-bold text-[#1e1e1e] mb-3">8. 本ポリシーの変更</h2>
                <p className="text-[#666] leading-relaxed">
                  当社は、法令の改正やサービスの変更に伴い、本プライバシーポリシーを変更することがあります。
                  重要な変更がある場合は、サービス上での通知またはメールにてお知らせします。
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-lg font-bold text-[#1e1e1e] mb-3">9. お問い合わせ</h2>
                <p className="text-[#666] mb-4">
                  本プライバシーポリシーに関するお問い合わせは、以下までご連絡ください：
                </p>
                <div className="bg-[#f6f5f4] rounded-xl p-6 text-[#666]">
                  <p className="font-bold text-[#1e1e1e] mb-2">Reserve運営事務局</p>
                  <p>メール: privacy@reserve-system.com</p>
                </div>
              </section>
            </div>

            <div className="mt-12 pt-8 border-t border-[#e8e4e2]">
              <Link href="/" className="inline-flex items-center gap-2 text-[#1e1e1e] hover:opacity-60 transition-opacity font-medium text-sm">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                トップページに戻る
              </Link>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-[#1e1e1e] text-[#888] py-12 px-4">
        <div className="max-w-5xl mx-auto text-center text-sm">
          <p>&copy; 2024 Reserve. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
