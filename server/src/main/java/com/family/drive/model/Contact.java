package com.family.drive.model;

import jakarta.persistence.*;

@Entity
@Table(name = "contacts", uniqueConstraints = {
    @UniqueConstraint(columnNames = {"user_id", "device_contact_id"})
})
public class Contact {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(name = "device_contact_id", nullable = false)
    private String deviceContactId;

    @Column(nullable = false)
    private String name;

    @Column(columnDefinition = "TEXT")
    private String phoneNumbers; // JSON string array

    @Column(columnDefinition = "TEXT")
    private String emails; // JSON string array

    @Column(name = "last_updated", nullable = false)
    private Long lastUpdated;

    public Contact() {}

    public Contact(User user, String deviceContactId, String name, String phoneNumbers, String emails, Long lastUpdated) {
        this.user = user;
        this.deviceContactId = deviceContactId;
        this.name = name;
        this.phoneNumbers = phoneNumbers;
        this.emails = emails;
        this.lastUpdated = lastUpdated;
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public User getUser() {
        return user;
    }

    public void setUser(User user) {
        this.user = user;
    }

    public String getDeviceContactId() {
        return deviceContactId;
    }

    public void setDeviceContactId(String deviceContactId) {
        this.deviceContactId = deviceContactId;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getPhoneNumbers() {
        return phoneNumbers;
    }

    public void setPhoneNumbers(String phoneNumbers) {
        this.phoneNumbers = phoneNumbers;
    }

    public String getEmails() {
        return emails;
    }

    public void setEmails(String emails) {
        this.emails = emails;
    }

    public Long getLastUpdated() {
        return lastUpdated;
    }

    public void setLastUpdated(Long lastUpdated) {
        this.lastUpdated = lastUpdated;
    }
}
