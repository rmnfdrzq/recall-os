from django.urls import path, include

urlpatterns = [
    # Core workspace application endpoints
    path('api/', include('core.urls')),
]
