---
# Feel free to add content and custom Front Matter to this file.
# To modify the layout, see https://jekyllrb.com/docs/themes/#overriding-theme-defaults

layout: home
---

- [404 page](./lessons/a_dsa/a_network_layers)
- [Link 1clear
](./lessons/0_planning/post_1)
- [Link 2](./posts/ornaz/post_1)

<ul>
  {% for post in site.posts %}
    <li>
      <a href="{{ post.url }}">{{ post.title }}</a>
    </li>
  {% endfor %}
</ul>

   <main class="container mt-4">
        <ul id="links" class="list-group"></ul>
    </main>
      <script>
        fetch('./data.json')
            .then(response => response.json())
            .then(data => {
                const links = document.getElementById('links');
                Object.keys(data).forEach(key => {
                    const listItem = document.createElement('li');
                    listItem.classList.add('list-group-item');
                    const link = document.createElement('a');
                    link.href = `./${key}`;
                    link.textContent = key;
                    listItem.appendChild(link);
                    links.appendChild(listItem);
                });
            })
            .catch(error => console.error('Error fetching data:', error));
    </script>
  
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0-alpha1/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-w0oKvGvdB7Bah2xOk1lnOfY8nB3JNuC5f+6a5iJuBP1a8XM8FTbAuyhDpV08aZcD" crossorigin="anonymous">
    <!-- Bootstrap JS -->
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0-alpha1/dist/js/bootstrap.bundle.min.js" integrity="sha384-X8aUfIKsM5cjDGMg2c4/ih41aF+b2hqVvq+vgl9+5Q5LmkF/zO+2hFQOu62zjuo+" crossorigin="anonymous"></script>
