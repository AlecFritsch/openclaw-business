import { zenblog } from "@/lib/zenblog";
import Link from "next/link";
import Image from "next/image";
import { Logo } from "@/components/logo";
import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";

export default async function BlogPage() {
  const t = await getTranslations("blog");
  const { data: posts } = await zenblog.posts.list() as any;

  return (
    <div className="bg-background min-h-screen">
      <nav className="border-border/50 border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center">
            <Logo />
          </Link>
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground text-sm transition-colors"
          >
            ← {t("backHome")}
          </Link>
        </div>
      </nav>

      <main className="mx-auto max-w-5xl px-6 py-16">
        <div className="mb-16 max-w-2xl">
          <p className="text-muted-foreground mb-2 text-sm font-medium uppercase tracking-wider">
            {t("label")}
          </p>
          <h1 className="font-serif text-4xl font-medium sm:text-5xl">
            {t("title")}
          </h1>
          <p className="text-muted-foreground mt-4 text-lg text-balance">
            {t("description")}
          </p>
        </div>

        {posts.length === 0 ? (
          <div className="text-muted-foreground py-24 text-center">
            <p className="text-lg">{t("noPosts")}</p>
          </div>
        ) : (
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post: any) => (
              <Link
                key={post.id}
                href={`/blog/${post.slug}`}
                className="group"
              >
                <article className="bg-card ring-border overflow-hidden rounded-2xl ring-1 transition-all duration-300 group-hover:shadow-lg group-hover:ring-2">
                  {post.cover_image && (
                    <div className="aspect-[16/9] overflow-hidden">
                      <Image
                        src={post.cover_image}
                        alt={post.title}
                        width={600}
                        height={338}
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    </div>
                  )}
                  <div className="p-5">
                    {post.published_at && (
                      <time className="text-muted-foreground text-xs">
                        {new Date(post.published_at).toLocaleDateString("de-DE", {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}
                      </time>
                    )}
                    <h2 className="mt-2 font-serif text-lg font-medium leading-snug">
                      {post.title}
                    </h2>
                    {post.subtitle && (
                      <p className="text-muted-foreground mt-2 line-clamp-2 text-sm">
                        {post.subtitle}
                      </p>
                    )}
                    <span className="mt-4 flex items-center gap-1 text-sm font-medium opacity-0 transition-opacity group-hover:opacity-100">
                      {t("readMore")} <ArrowRight className="size-3.5" />
                    </span>
                  </div>
                </article>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
