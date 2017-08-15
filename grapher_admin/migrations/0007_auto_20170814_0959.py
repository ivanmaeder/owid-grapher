# -*- coding: utf-8 -*-
# Generated by Django 1.11 on 2017-06-02 04:13
from __future__ import unicode_literals
from django.db import migrations, models, transaction
import json

def remove_country_time_title(apps, schema_editor):
    Chart = apps.get_model('grapher_admin', 'Chart')
    with transaction.atomic():
        for chart in Chart.objects.all():
            title = chart.name
            newtitle = title.replace(", *time*", "").replace("from *time*", "").replace("in *time*", "").replace(" *time*", "").replace("*country* – ", "").replace(" in *country*", "").replace(", *country*", "").replace(" *country*", "")
            if title != newtitle:
                print(title)
                print(newtitle)
                print()
                chart.name = newtitle            
                chart.save()

class Migration(migrations.Migration):
    dependencies = [
        ('grapher_admin', '0006_merge_20170801_0444'),
    ]
    operations = [
        migrations.RunPython(remove_country_time_title),
    ]