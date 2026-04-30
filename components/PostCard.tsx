import Link from "next/link";
import { type Post, typeLabel, formatDate } from "@/lib/posts";

export default function PostCard({ post }: { post: Post }) {
  return (
    <Link
      href={`/journal/${post.slug}`}
      className="group block border border-brand-ink/15 rounded-lg overflow-hidden hover:border-brand-yellow transition-colors bg-white"
    >
      {post.hero ? (
        <div className="aspect-[16/10] bg-brand-paper overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={post.hero}
            alt=""
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        </div>
      ) : (
        <div className="aspect-[16/10] bg-brand-yellow/20 flex items-center justify-center">
          <span className="font-marker text-2xl text-brand-ink/30">
            {typeLabel(post.type)}
          </span>
        </div>
      )}
      <div className="p-5">
        <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
          {typeLabel(post.type)}
          <span className="text-brand-ink/40 ml-2">
            · {formatDate(post.date)}
          </span>
        </p>
        <h3 className="font-marker text-2xl mb-2 leading-tight">
          {post.title}
        </h3>
        {post.excerpt && (
          <p className="text-sm text-brand-ink/70 leading-relaxed">
            {post.excerpt}
          </p>
        )}
      </div>
    </Link>
  );
}
