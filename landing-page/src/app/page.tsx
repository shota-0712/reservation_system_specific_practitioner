import Link from 'next/link';

export default function Home() {
  const adminBaseUrl = (process.env.NEXT_PUBLIC_ADMIN_URL || '').replace(/\/+$/, '');
  const loginUrl = adminBaseUrl ? `${adminBaseUrl}/login` : '/login';
  const registerUrl = adminBaseUrl ? `${adminBaseUrl}/register` : '/register';

  return (
    <div className="min-h-screen bg-[#f6f5f4]">
      {/* Header */}
      <header className="fixed top-5 left-1/2 -translate-x-1/2 z-50 w-[95%] max-w-5xl">
        <div className="bg-white/90 backdrop-blur-md rounded-2xl shadow-sm border border-[#e8e4e2] px-6 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-[#ff2f2f] via-[#ef7b16] to-[#8a43e1] rounded-xl flex items-center justify-center">
              <span className="text-white font-bold text-sm">R</span>
            </div>
            <span className="font-bold text-lg text-[#1e1e1e]">Reserve</span>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm">
            <a href="#features" className="text-[#1e1e1e] hover:opacity-60 transition-opacity font-medium">機能</a>
            <a href="#pricing" className="text-[#1e1e1e] hover:opacity-60 transition-opacity font-medium">料金</a>
            <a href="#contact" className="text-[#1e1e1e] hover:opacity-60 transition-opacity font-medium">お問い合わせ</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link
              href={loginUrl}
              className="px-4 py-2 text-sm text-[#1e1e1e] font-medium hover:opacity-60 transition-opacity"
            >
              ログイン
            </Link>
            <a
              href={registerUrl}
              className="px-5 py-2.5 text-sm text-white font-semibold rounded-full bg-gradient-to-r from-[#ff2f2f] via-[#ef7b16] via-[#8a43e1] to-[#d511fd] hover:opacity-90 transition-opacity"
            >
              無料で始める
            </a>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-36 pb-24 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-[#ded8d3] rounded-full text-sm font-medium text-[#1e1e1e] mb-8">
            <span className="w-2 h-2 bg-gradient-to-r from-[#ff2f2f] to-[#ef7b16] rounded-full"></span>
            美容室・サロン向け予約システム
          </div>
          <h1 className="text-4xl md:text-6xl font-bold text-[#1e1e1e] mb-6 leading-tight tracking-tight">
            美容室に必要な機能、
            <br />
            <span className="bg-gradient-to-r from-[#ff2f2f] via-[#ef7b16] via-[#8a43e1] to-[#d511fd] bg-clip-text text-transparent">
              すべて1つに
            </span>
          </h1>
          <p className="text-lg md:text-xl text-[#666] mb-10 max-w-2xl mx-auto leading-relaxed">
            お客様はLINEから簡単予約。スタッフは直感的な管理画面で効率的に。
            <br className="hidden md:block" />
            複数店舗にも対応した、美容業界のための予約システム。
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href={registerUrl}
              className="px-8 py-4 text-white font-semibold rounded-full bg-gradient-to-r from-[#ff2f2f] via-[#ef7b16] via-[#8a43e1] to-[#d511fd] hover:opacity-90 transition-opacity shadow-lg"
            >
              無料トライアルを始める
            </a>
            <a
              href="#features"
              className="px-8 py-4 bg-white text-[#1e1e1e] font-semibold rounded-full border border-[#ded8d3] hover:bg-[#f1f0ee] transition-colors"
            >
              詳しく見る
            </a>
          </div>
        </div>

        {/* Hero Image */}
        <div className="max-w-5xl mx-auto mt-20">
          <div className="bg-white rounded-3xl p-2 shadow-[0_1px_1px_#0000001a,0_8px_32px_#0000000d]">
            <div className="bg-[#f1f0ee] rounded-2xl overflow-hidden">
              <div className="h-10 bg-[#e8e4e2] flex items-center px-4 gap-2">
                <div className="w-3 h-3 rounded-full bg-[#ff5f57]"></div>
                <div className="w-3 h-3 rounded-full bg-[#febc2e]"></div>
                <div className="w-3 h-3 rounded-full bg-[#28c840]"></div>
                <div className="flex-1 flex justify-center">
                  <div className="bg-white/60 rounded-md px-20 py-1 text-xs text-[#888]">reserve-admin.com</div>
                </div>
              </div>
              <div className="p-8 min-h-[400px] flex items-center justify-center">
                <div className="text-center">
                  <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-[#ff2f2f] via-[#ef7b16] to-[#8a43e1] rounded-2xl flex items-center justify-center">
                    <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                    </svg>
                  </div>
                  <p className="text-[#888] text-sm">管理ダッシュボードのイメージ</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { number: '500+', label: '導入サロン数' },
              { number: '98%', label: '継続率' },
              { number: '40%', label: '無断キャンセル削減' },
              { number: '24h', label: 'サポート対応' },
            ].map((stat, i) => (
              <div key={i} className="bg-white rounded-2xl p-6 text-center shadow-[0_1px_1px_#0000001a,0_3px_8px_#0000000d]">
                <div className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-[#ff2f2f] via-[#ef7b16] to-[#8a43e1] bg-clip-text text-transparent mb-2">
                  {stat.number}
                </div>
                <div className="text-sm text-[#666]">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-[#ded8d3] rounded-full text-sm font-medium text-[#1e1e1e] mb-6">
              機能紹介
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-[#1e1e1e] mb-4 tracking-tight">
              予約管理に必要な機能を
              <br />
              ワンストップで提供
            </h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {/* Feature Cards */}
            {[
              {
                icon: (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                ),
                title: 'LINE予約',
                description: 'お客様はLINEアプリから直接予約。新規アプリのインストール不要で、予約率が向上。',
                gradient: 'from-[#06c755] to-[#00b341]',
              },
              {
                icon: (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                ),
                title: '売上分析',
                description: '売上・予約数・顧客分析がリアルタイムで確認。データドリブンな経営判断をサポート。',
                gradient: 'from-[#3b82f6] to-[#1d4ed8]',
              },
              {
                icon: (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                ),
                title: 'スタッフ管理',
                description: 'スタッフごとの勤務スケジュール、指名料、対応メニューを柔軟に設定。',
                gradient: 'from-[#8b5cf6] to-[#6d28d9]',
              },
              {
                icon: (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                ),
                title: '自動リマインダー',
                description: '予約の前日・当日にLINEで自動通知。無断キャンセルを減らし、来店率を向上。',
                gradient: 'from-[#f59e0b] to-[#d97706]',
              },
              {
                icon: (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                ),
                title: '複数店舗対応',
                description: '3店舗から50店舗まで対応。店舗ごとの設定や統合レポートで、グループ経営を効率化。',
                gradient: 'from-[#ec4899] to-[#be185d]',
              },
              {
                icon: (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                ),
                title: 'セキュリティ',
                description: 'Google Cloudの堅牢なインフラで、大切な顧客データを安全に管理。SSL/TLS完全対応。',
                gradient: 'from-[#14b8a6] to-[#0d9488]',
              },
            ].map((feature, i) => (
              <div
                key={i}
                className="bg-white rounded-[20px] p-6 shadow-[0_1px_1px_#0000001a,0_3px_8px_#0000000d] hover:shadow-[0_1px_1px_#0000001a,0_8px_24px_#0000001a] transition-shadow"
              >
                <div className={`w-12 h-12 bg-gradient-to-br ${feature.gradient} rounded-xl flex items-center justify-center mb-4 text-white`}>
                  {feature.icon}
                </div>
                <h3 className="text-lg font-bold text-[#1e1e1e] mb-2">{feature.title}</h3>
                <p className="text-[#666] text-sm leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20 px-4 bg-[#1e1e1e]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/20 rounded-full text-sm font-medium text-white mb-6">
              導入の流れ
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 tracking-tight">
              最短3日で導入完了
            </h2>
            <p className="text-[#888] text-lg">
              専任担当が導入から運用までサポートします
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              { step: '01', title: 'お申し込み', description: 'フォームから申し込み。最短翌日に担当者からご連絡します。' },
              { step: '02', title: '初期設定', description: 'メニュー・スタッフ・営業時間などを一緒に設定します。' },
              { step: '03', title: '運用開始', description: 'LINE公式アカウントと連携して、すぐに予約受付を開始できます。' },
            ].map((item, i) => (
              <div key={i} className="text-center">
                <div className="text-5xl font-bold bg-gradient-to-r from-[#ff2f2f] via-[#ef7b16] to-[#8a43e1] bg-clip-text text-transparent mb-4">
                  {item.step}
                </div>
                <h3 className="text-xl font-bold text-white mb-2">{item.title}</h3>
                <p className="text-[#888] text-sm">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-[#ded8d3] rounded-full text-sm font-medium text-[#1e1e1e] mb-6">
              料金プラン
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-[#1e1e1e] mb-4 tracking-tight">
              シンプルで分かりやすい料金
            </h2>
            <p className="text-[#666] text-lg">
              初期費用0円・14日間無料トライアル
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {/* Starter Plan */}
            <div className="bg-white rounded-[20px] p-8 shadow-[0_1px_1px_#0000001a,0_3px_8px_#0000000d]">
              <div className="text-sm font-medium text-[#888] mb-2">スターター</div>
              <div className="mb-6">
                <span className="text-4xl font-bold text-[#1e1e1e]">¥9,800</span>
                <span className="text-[#888]">/月</span>
              </div>
              <p className="text-sm text-[#666] mb-6 pb-6 border-b border-[#e8e4e2]">1〜3店舗の小規模サロン向け</p>
              <ul className="space-y-3 mb-8">
                {['LINE予約機能', '管理ダッシュボード', '自動リマインダー', 'メールサポート'].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm text-[#1e1e1e]">
                    <svg className="w-5 h-5 text-[#06c755]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
              <a
                href={registerUrl}
                className="block w-full py-3 text-center bg-[#f1f0ee] text-[#1e1e1e] font-semibold rounded-full hover:bg-[#e8e4e2] transition-colors"
              >
                無料で始める
              </a>
            </div>

            {/* Professional Plan */}
            <div className="bg-[#1e1e1e] rounded-[20px] p-8 relative md:-translate-y-4 shadow-xl">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-gradient-to-r from-[#ff2f2f] via-[#ef7b16] to-[#8a43e1] text-white text-xs font-bold rounded-full">
                人気No.1
              </div>
              <div className="text-sm font-medium text-[#888] mb-2">プロフェッショナル</div>
              <div className="mb-6">
                <span className="text-4xl font-bold text-white">¥29,800</span>
                <span className="text-[#888]">/月</span>
              </div>
              <p className="text-sm text-[#888] mb-6 pb-6 border-b border-[#333]">3〜10店舗の成長サロン向け</p>
              <ul className="space-y-3 mb-8">
                {['スターターの全機能', '複数店舗管理', '詳細レポート', '優先サポート'].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm text-white">
                    <svg className="w-5 h-5 text-[#06c755]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
              <a
                href={registerUrl}
                className="block w-full py-3 text-center text-white font-semibold rounded-full bg-gradient-to-r from-[#ff2f2f] via-[#ef7b16] via-[#8a43e1] to-[#d511fd] hover:opacity-90 transition-opacity"
              >
                無料トライアル
              </a>
            </div>

            {/* Enterprise Plan */}
            <div className="bg-white rounded-[20px] p-8 shadow-[0_1px_1px_#0000001a,0_3px_8px_#0000000d]">
              <div className="text-sm font-medium text-[#888] mb-2">エンタープライズ</div>
              <div className="mb-6">
                <span className="text-4xl font-bold text-[#1e1e1e]">要相談</span>
              </div>
              <p className="text-sm text-[#666] mb-6 pb-6 border-b border-[#e8e4e2]">10店舗以上の大規模グループ向け</p>
              <ul className="space-y-3 mb-8">
                {['プロの全機能', 'カスタマイズ対応', '専任サポート', 'SLA保証'].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm text-[#1e1e1e]">
                    <svg className="w-5 h-5 text-[#06c755]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
              <a
                href={registerUrl}
                className="block w-full py-3 text-center bg-[#f1f0ee] text-[#1e1e1e] font-semibold rounded-full hover:bg-[#e8e4e2] transition-colors"
              >
                無料で始める
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Contact Section */}
      <section id="contact" className="py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-[24px] p-8 md:p-12 shadow-[0_1px_1px_#0000001a,0_8px_32px_#0000000d]">
            <div className="grid md:grid-cols-2 gap-12">
              <div>
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-[#f6f5f4] border border-[#ded8d3] rounded-full text-sm font-medium text-[#1e1e1e] mb-6">
                  お問い合わせ
                </div>
                <h2 className="text-2xl md:text-3xl font-bold text-[#1e1e1e] mb-4 tracking-tight">
                  14日間無料で
                  <br />
                  お試しください
                </h2>
                <p className="text-[#666] mb-8">
                  導入のご相談、デモのご依頼など、お気軽にお問い合わせください。専任担当が丁寧にご対応します。
                </p>
                <div className="space-y-4 text-sm text-[#666]">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#f6f5f4] rounded-xl flex items-center justify-center">
                      <svg className="w-5 h-5 text-[#1e1e1e]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </div>
                    support@reserve-system.com
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#f6f5f4] rounded-xl flex items-center justify-center">
                      <svg className="w-5 h-5 text-[#1e1e1e]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    平日 10:00 - 18:00
                  </div>
                </div>
              </div>

              <form className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-[#1e1e1e] mb-2">
                    会社名・店舗名 <span className="text-[#ff2f2f]">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    className="w-full px-4 py-3 bg-[#f6f5f4] rounded-xl border-0 focus:ring-2 focus:ring-[#09f] outline-none transition-all text-sm"
                    placeholder="株式会社〇〇"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#1e1e1e] mb-2">
                    お名前 <span className="text-[#ff2f2f]">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    className="w-full px-4 py-3 bg-[#f6f5f4] rounded-xl border-0 focus:ring-2 focus:ring-[#09f] outline-none transition-all text-sm"
                    placeholder="山田 太郎"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#1e1e1e] mb-2">
                    メールアドレス <span className="text-[#ff2f2f]">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    className="w-full px-4 py-3 bg-[#f6f5f4] rounded-xl border-0 focus:ring-2 focus:ring-[#09f] outline-none transition-all text-sm"
                    placeholder="info@example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#1e1e1e] mb-2">
                    電話番号
                  </label>
                  <input
                    type="tel"
                    className="w-full px-4 py-3 bg-[#f6f5f4] rounded-xl border-0 focus:ring-2 focus:ring-[#09f] outline-none transition-all text-sm"
                    placeholder="03-1234-5678"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#1e1e1e] mb-2">
                    店舗数
                  </label>
                  <select className="w-full px-4 py-3 bg-[#f6f5f4] rounded-xl border-0 focus:ring-2 focus:ring-[#09f] outline-none transition-all text-sm">
                    <option value="">選択してください</option>
                    <option value="1">1店舗</option>
                    <option value="2-3">2〜3店舗</option>
                    <option value="4-10">4〜10店舗</option>
                    <option value="11+">11店舗以上</option>
                  </select>
                </div>
                <button
                  type="submit"
                  className="w-full py-4 text-white font-semibold rounded-full bg-gradient-to-r from-[#ff2f2f] via-[#ef7b16] via-[#8a43e1] to-[#d511fd] hover:opacity-90 transition-opacity"
                >
                  送信する
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#1e1e1e] text-[#888] py-16 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-4 gap-12 mb-12">
            <div className="md:col-span-2">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 bg-gradient-to-br from-[#ff2f2f] via-[#ef7b16] to-[#8a43e1] rounded-xl flex items-center justify-center">
                  <span className="text-white font-bold text-sm">R</span>
                </div>
                <span className="font-bold text-lg text-white">Reserve</span>
              </div>
              <p className="text-sm leading-relaxed">
                美容室・サロン向けLINE予約システム。
                <br />
                お客様はLINEから簡単予約、スタッフは直感的な管理画面で効率的に。
              </p>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4 text-sm">製品</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#features" className="hover:text-white transition-colors">機能</a></li>
                <li><a href="#pricing" className="hover:text-white transition-colors">料金</a></li>
                <li><a href="#" className="hover:text-white transition-colors">導入事例</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4 text-sm">法的情報</h4>
              <ul className="space-y-2 text-sm">
                <li><Link href="/privacy" className="hover:text-white transition-colors">プライバシーポリシー</Link></li>
                <li><Link href="/terms" className="hover:text-white transition-colors">利用規約</Link></li>
                <li><a href="#" className="hover:text-white transition-colors">特定商取引法</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-[#333] pt-8 text-center text-sm">
            <p>&copy; 2024 Reserve. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
