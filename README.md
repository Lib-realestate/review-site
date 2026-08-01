# ためして選ぶノート — 比較レビューサイト

Markdownで記事を書く → `npm run build` で `docs/` にSEO対応の静的HTMLを自動生成 → GitHub Pagesで公開、という構成です。

## 構成

```
content/
  site.json          サイト全体設定（サイト名・ドメイン・カテゴリ一覧）
  articles/*.md       記事本体（1記事=1ファイル）
templates/
  article.html         記事ページの型
  list.html            トップ・カテゴリ一覧ページの型
assets/css/style.css  デザイン（全ページ共通）
build.js               ビルドスクリプト
docs/                  ビルド後の出力（GitHub Pages公開対象。gitには積まない運用）
.github/workflows/deploy.yml   push時に自動ビルド＆自動公開するActions
```

## 1. 最初にやること（公開前に1回だけ）

`content/site.json` の `baseUrl` と `basePath` を、公開先に合わせて書き換える。

**独自ドメインのルートで公開する場合**（推奨・本番向け）
```json
"baseUrl": "https://あなたのドメイン.com",
"basePath": ""
```

**独自ドメインをまだ持っておらず、`https://ユーザー名.github.io/リポジトリ名/` で公開する場合**
```json
"baseUrl": "https://ユーザー名.github.io",
"basePath": "/リポジトリ名"
```

ここを実際の公開先に合わせないと、sitemap・canonical・OGP・CSSの読み込みパスが全部ズレるので必ず変更する。

## 2. 記事を追加する手順

1. `content/articles/` に新しいファイルを作る（例：`laundry-detergent-hikaku.md`）
2. 先頭にfrontmatterを書く：

```markdown
---
title: "洗濯洗剤・柔軟剤比較｜部屋干し臭に強いのはどれ？"
slug: "laundry-detergent-hikaku"
description: "検索結果や一覧カードに出る要約文（120字前後）"
category: "洗濯・掃除"
keywords: ["洗濯洗剤 比較", "部屋干し 臭わない"]
date: "2026-08-10"
updated: "2026-08-10"
author: "レビュー編集部"
---

## こんな場面、ありませんか
本文はここから普通のMarkdownで書く。見出しは## 、表は | で作れる。
```

3. `category` は `content/site.json` の `categories` に登録済みの名前を使う（新ジャンルを追加したい場合は先に3.を実施）
4. 保存したら完了。ビルドすれば自動で一覧・カテゴリページ・sitemapに反映される

**記事を消す・非公開にする場合**は該当の`.md`ファイルを削除するかリネームするだけでよい。

## 2.5 アフィリエイトの購入ボタンを商品ごとに付ける

楽天アフィリエイトの「リンクのみ」または「テキストのみ」で作ったURLを、商品ごとにfrontmatterへ追加するだけで、本文の該当する`###`見出しの直後に「楽天市場で見る」ボタンが自動で入る。

```yaml
products:
  - name: "メリーズ さらさらエアスルー パンツ"
    url: "https://hb.afl.rakuten.co.jp/ichiba/...（アフィリエイトURL）"
  - name: "パンパース はじめての肌へのいちばん テープ"
    url: "https://hb.afl.rakuten.co.jp/ichiba/...（アフィリエイトURL）"
```

**注意点**
- `name` は本文中の `### 商品名` の見出しと**1文字も違わず**一致させる（コピペ推奨）
- 一致しない場合はビルド時に警告が出て、その商品だけボタンが付かない（他の記事には影響しない）
- 全商品にURLを用意する必要はない。用意できたものだけ追加すればよい
- 楽天のリンク生成画面で「画像とテキスト」を選ぶと今回のような長いHTMLタグになるが、ここでは**URLだけ**でよいので「リンクのみ」を選ぶとコピペが楽

## 3. 新しいカテゴリ（商品ジャンル）を追加する手順

`content/site.json` の `categories` に1行追加する。

```json
{ "name": "洗濯・掃除", "slug": "cleaning" }
```

`slug` は半角英数字とハイフンのみ（URLに使われる）。日本語の`name`はそのまま画面に表示される。

## 4. ビルド・確認

```bash
npm install      # 初回のみ
npm run build    # docs/ に生成
```

ローカルで見た目を確認したい場合：

```bash
npx serve docs
```

## 5. GitHub Pagesへの公開

1. このフォルダをGitHubリポジトリにする（新規リポジトリ推奨。既存のlib-realestate系とは別ドメイン運用）
2. push すると `.github/workflows/deploy.yml` が自動で `npm run build` → 公開まで行う
3. リポジトリの Settings → Pages → Source を **「GitHub Actions」** に設定（ブランチ選択方式ではない点に注意）
4. 独自ドメインを使う場合：Settings → Pages → Custom domain に入力し、DNS側（Cloudflare）でCNAMEレコードを設定

自動化を使わず手動で公開したい場合は、`.gitignore` から `docs/` を外して `npm run build` 後に `docs/` ごとコミットし、Settings → Pages → Source を `main` ブランチ `/docs` に設定する。

## 6. Google Search Consoleの所有権確認

1. https://search.google.com/search-console/ で「HTMLタグ」方式を選び、`content="..."` の中身（コードの文字列だけ）をコピー
2. `content/site.json` の `"googleSiteVerification": ""` の `""` の中に貼り付ける
3. `git add . / git commit / git push`（またはGitHub Desktopでコミット→Push）
4. Actionsのビルドが終わるのを待つ
5. Search Consoleに戻って「確認」をクリック

このフィールドが空欄の間は何も出力されないので、使わない場合はそのままで問題ない。

## SEOのために自動でやっていること

- 記事ごとに固有URL（`/articles/スラッグ/`）と個別のtitle・description・OGP・Twitter Card
- 記事ごとにJSON-LD（Article構造化データ）を自動出力
- カテゴリごとのアーカイブページ（`/category/スラッグ/`）を自動生成 → 同ジャンル記事の内部リンクが増え、トピックのまとまりとして評価されやすくなる
- `sitemap.xml` / `robots.txt` / `rss.xml` を自動生成
- 各ページで見出し階層（h1は1つ、h2以下で構造化）を統一
- 全ページ静的HTML（JS実行なしでも全文がそのまま読める＝クローラーに優しい構成）

## まだ入っていないもの（必要になったら追加）

- 記事内画像の最適化（今は画像を使わないテキスト＋表中心の構成）
- サイト内検索（記事数が増えてきたら、Cloudflare Workerで簡易全文検索を足すのが現実的）
- PR表記の自動挿入（今はfooterに固定文言のみ。記事本文側にも明示したい場合はテンプレート側 `templates/article.html` の `.stamp` 付近に追記する）
