import Link from 'next/link';

export default function Terms() {
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
              利用規約
            </div>

            <h1 className="text-2xl md:text-3xl font-bold text-[#1e1e1e] mb-4 tracking-tight">
              利用規約
            </h1>

            <p className="text-sm text-[#888] mb-8">
              最終更新日: 2024年1月1日
            </p>

            <div className="prose prose-sm max-w-none">
              <section className="mb-8">
                <h2 className="text-lg font-bold text-[#1e1e1e] mb-3">第1条（適用）</h2>
                <p className="text-[#666] leading-relaxed">
                  本利用規約（以下「本規約」）は、Reserve（以下「当社」）が提供する予約システムサービス
                  （以下「本サービス」）の利用に関する条件を定めるものです。
                  本サービスを利用するすべてのユーザー（以下「ユーザー」）は、本規約に同意したものとみなされます。
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-lg font-bold text-[#1e1e1e] mb-3">第2条（サービスの内容）</h2>
                <p className="text-[#666] mb-3">当社は、以下のサービスを提供します：</p>
                <ul className="list-disc list-inside text-[#666] space-y-2 ml-2">
                  <li>美容室・サロン向けオンライン予約システム</li>
                  <li>LINE連携による予約機能</li>
                  <li>顧客管理機能</li>
                  <li>予約リマインダー通知機能</li>
                  <li>売上・予約分析レポート機能</li>
                </ul>
              </section>

              <section className="mb-8">
                <h2 className="text-lg font-bold text-[#1e1e1e] mb-3">第3条（アカウント登録）</h2>
                <ol className="list-decimal list-inside text-[#666] space-y-2 ml-2">
                  <li>本サービスの利用には、アカウント登録が必要です。</li>
                  <li>登録時には、正確かつ最新の情報を提供してください。</li>
                  <li>アカウント情報の管理はユーザーの責任で行ってください。</li>
                  <li>アカウントの不正利用が発覚した場合、当社は当該アカウントを停止できます。</li>
                </ol>
              </section>

              <section className="mb-8">
                <h2 className="text-lg font-bold text-[#1e1e1e] mb-3">第4条（料金と支払い）</h2>
                <ol className="list-decimal list-inside text-[#666] space-y-2 ml-2">
                  <li>本サービスの利用料金は、当社が別途定める料金表に従います。</li>
                  <li>料金は月額制とし、毎月末日締め、翌月末日払いとします。</li>
                  <li>料金の支払いが遅延した場合、年14.6%の遅延損害金が発生します。</li>
                  <li>当社は、1ヶ月前の事前通知により、料金を改定できるものとします。</li>
                </ol>
              </section>

              <section className="mb-8">
                <h2 className="text-lg font-bold text-[#1e1e1e] mb-3">第5条（禁止事項）</h2>
                <p className="text-[#666] mb-3">ユーザーは、以下の行為を行ってはなりません：</p>
                <ul className="list-disc list-inside text-[#666] space-y-2 ml-2">
                  <li>法令または公序良俗に違反する行為</li>
                  <li>当社または第三者の権利を侵害する行為</li>
                  <li>本サービスの運営を妨害する行為</li>
                  <li>不正アクセスまたはそれを試みる行為</li>
                  <li>虚偽の情報を登録する行為</li>
                  <li>他のユーザーになりすます行為</li>
                  <li>本サービスを利用した営業活動、宣伝行為（当社が認めた場合を除く）</li>
                  <li>反社会的勢力への利益供与</li>
                </ul>
              </section>

              <section className="mb-8">
                <h2 className="text-lg font-bold text-[#1e1e1e] mb-3">第6条（知的財産権）</h2>
                <ol className="list-decimal list-inside text-[#666] space-y-2 ml-2">
                  <li>本サービスに関する知的財産権は、当社または正当な権利者に帰属します。</li>
                  <li>ユーザーは、本サービスを通じて提供されるコンテンツを、私的利用の範囲を超えて複製、改変、配布することはできません。</li>
                  <li>ユーザーが本サービスに投稿したコンテンツについて、当社はサービス提供に必要な範囲で利用する権利を有します。</li>
                </ol>
              </section>

              <section className="mb-8">
                <h2 className="text-lg font-bold text-[#1e1e1e] mb-3">第7条（サービスの変更・停止）</h2>
                <ol className="list-decimal list-inside text-[#666] space-y-2 ml-2">
                  <li>当社は、事前の通知なく本サービスの内容を変更できるものとします。</li>
                  <li>当社は、以下の場合、本サービスを一時的に停止できます：
                    <ul className="list-disc list-inside ml-6 mt-2">
                      <li>システムの保守・点検を行う場合</li>
                      <li>火災、停電、天災等の不可抗力による場合</li>
                      <li>その他、当社がサービスの停止が必要と判断した場合</li>
                    </ul>
                  </li>
                  <li>当社は、3ヶ月前の事前通知により、本サービスを終了できるものとします。</li>
                </ol>
              </section>

              <section className="mb-8">
                <h2 className="text-lg font-bold text-[#1e1e1e] mb-3">第8条（免責事項）</h2>
                <ol className="list-decimal list-inside text-[#666] space-y-2 ml-2">
                  <li>当社は、本サービスの完全性、正確性、確実性を保証しません。</li>
                  <li>当社は、本サービスの利用により生じた損害について、当社に故意または重過失がある場合を除き、責任を負いません。</li>
                  <li>当社の損害賠償責任は、直接かつ通常の損害に限り、ユーザーが過去12ヶ月間に支払った利用料金を上限とします。</li>
                </ol>
              </section>

              <section className="mb-8">
                <h2 className="text-lg font-bold text-[#1e1e1e] mb-3">第9条（契約解除）</h2>
                <ol className="list-decimal list-inside text-[#666] space-y-2 ml-2">
                  <li>ユーザーは、当社所定の方法により、いつでも本サービスを解約できます。</li>
                  <li>当社は、ユーザーが本規約に違反した場合、事前の催告なく利用契約を解除できます。</li>
                  <li>解約後も、既に発生した料金の支払い義務は消滅しません。</li>
                </ol>
              </section>

              <section className="mb-8">
                <h2 className="text-lg font-bold text-[#1e1e1e] mb-3">第10条（規約の変更）</h2>
                <p className="text-[#666] leading-relaxed">
                  当社は、必要に応じて本規約を変更することがあります。変更後の規約は、本サービス上に
                  掲示した時点から効力を生じます。重要な変更がある場合は、事前に通知します。
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-lg font-bold text-[#1e1e1e] mb-3">第11条（準拠法・管轄裁判所）</h2>
                <ol className="list-decimal list-inside text-[#666] space-y-2 ml-2">
                  <li>本規約の解釈は、日本法に準拠します。</li>
                  <li>本サービスに関する紛争は、東京地方裁判所を第一審の専属的合意管轄裁判所とします。</li>
                </ol>
              </section>

              <section className="mb-8">
                <h2 className="text-lg font-bold text-[#1e1e1e] mb-3">第12条（お問い合わせ）</h2>
                <p className="text-[#666] mb-4">
                  本規約に関するお問い合わせは、以下までご連絡ください：
                </p>
                <div className="bg-[#f6f5f4] rounded-xl p-6 text-[#666]">
                  <p className="font-bold text-[#1e1e1e] mb-2">Reserve運営事務局</p>
                  <p>メール: support@reserve-system.com</p>
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
