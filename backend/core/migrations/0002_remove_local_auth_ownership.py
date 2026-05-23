from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0001_initial'),
    ]

    operations = [
        migrations.RunSQL(
            sql=[
                'ALTER TABLE core_document DROP COLUMN IF EXISTS user_id',
                'ALTER TABLE core_chatsession DROP COLUMN IF EXISTS user_id',
            ],
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
