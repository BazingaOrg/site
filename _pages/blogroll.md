---
layout: default
title: Blogroll
type: static
---

<a href="/blogroll.xml">RSS</a>

This page is frequently updated. Only websites that are being actively updated are included (in theory), and blogs are ordered by addition time (oldest first).

---

{% if site.data.blogroll and site.data.blogroll.size > 0 %}
{%- comment -%} File order IS addition order (entries are appended), matching the copy above and feeds/blogroll.xml. {%- endcomment -%}
{%- for item in site.data.blogroll %}
## [{{ item.title }}]({{ item.url }}) <code class="smol">({{ item.lang }})</code>
{{ item.description }}
{%- endfor %}
{% else %}
<div class="empty-state">
  <p><em>Nothing here yet.</em></p>
</div>
{% endif %}
