import { zenblog } from "@/lib/zenblog";
import Link from "next/link";
import Image from "next/image";
import { Logo } from "@/components/logo";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import sanitizeHtml from "sanitize-html";

export default async function BlogPost({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = await getTranslations("blog");

  let post: any;
  try {
    const { data } = await zenblog.posts.get({ slug }) as any;
    post = data;
  } catch {
    notFound();
  }

  return (
    <div className="bg-background min-h-screen">
      <nav className="border-border/50 border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center">
            <Logo />
          </Link>
          <Link
            href="/blog"
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            {t("backToBlog")}
          </Link>
        </div>
      </nav>

      <article className="mx-auto max-w-3xl px-6 py-16">
        {post.published_at && (
          <time className="text-muted-foreground text-sm">
            {new Date(post.published_at).toLocaleDateString("de-DE", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </time>
        )}
        <h1 className="mt-3 font-serif text-3xl font-medium sm:text-4xl lg:text-5xl">
          {post.title}
        </h1>
        {post.subtitle && (
          <p className="text-muted-foreground mt-4 text-lg">{post.subtitle}</p>
        )}

        {post.cover_image && (
          <div className="mt-10 overflow-hidden rounded-2xl">
            <Image
              src={post.cover_image}
              alt={post.title}
              width={1200}
              height={675}
              className="w-full object-cover"
              priority
            />
          </div>
        )}

        <div
          className="prose prose-neutral dark:prose-invert prose-headings:font-serif prose-headings:font-medium prose-a:underline-offset-4 mt-12 max-w-none"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(post.html_content, { allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2"]), allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, img: ["src", "alt", "width", "height", "loading"] } }) }}
        />
      </article>
    </div>
  );
}
