---
# Feel free to add content and custom Front Matter to this file.
# To modify the layout, see https://jekyllrb.com/docs/themes/#overriding-theme-defaults

layout: home
---
- [404 page](./lessons/a_dsa/a_network_layers)
- [Link 2](./lessons/0_planning/post_1)
- [Link 2](./posts/ornaz/post_1)

<ul>
  {% for post in site.posts %}
    <li>
      <a href="{{ post.url }}">{{ post.title }}</a>
    </li>
  {% endfor %}
</ul>