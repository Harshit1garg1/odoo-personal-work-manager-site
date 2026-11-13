{
    'name': 'Odoo Work Assistant',
    'version': '19.0.0.2.0',
    'summary': 'Permission-aware ChatGPT work tools and custom workflow mappings',
    'license': 'LGPL-3',
    'depends': ['base'],
    'data': ['security/ir.model.access.csv', 'security/rules.xml', 'views/profile.xml'],
    'installable': True,
    'application': False,
}
